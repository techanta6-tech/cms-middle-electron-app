using System;
using System.IO;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class Startup
{
    private const string DLL_NAME = "Sdk_C_Sharp_Lib.dll";

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool SetDllDirectory(string lpPathName);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    // === Delegates ===
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void SDK_DISCONN_CB(UInt32 handle, IntPtr p_obj, UInt32 type);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void SDK_ALARM_CB(UInt32 handle, ref IntPtr p_data, IntPtr p_obj);

    // Callback cho live stream (cần để chụp ảnh)
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void SDK_LIVE_CB(UInt32 md_handle, UInt32 data_type, IntPtr p_data, UInt32 data_len, IntPtr p_obj);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void SDK_DETECT_CB(UInt32 handle, Int32 stream_id, ref IntPtr p_result, IntPtr p_data, IntPtr p_obj);

    // === DLL Imports ===
    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern Int32 sdk_dev_init([MarshalAs(UnmanagedType.LPStr)] string p_param);

    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern UInt32 sdk_dev_conn([MarshalAs(UnmanagedType.LPStr)] string p_ip, UInt16 port,
        [MarshalAs(UnmanagedType.LPStr)] string p_user, [MarshalAs(UnmanagedType.LPStr)] string p_passwd,
        [MarshalAs(UnmanagedType.FunctionPtr)] SDK_DISCONN_CB disconn_cb_func, IntPtr p_obj);

    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern void sdk_dev_conn_close(UInt32 handle);

    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern Int32 sdk_dev_start_alarm(UInt32 handle,
        [MarshalAs(UnmanagedType.FunctionPtr)] SDK_ALARM_CB alarm_cb, IntPtr p_obj);

    [DllImport("sdk.dll", CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern Int32 sdks_dev_face_detect_start(UInt32 handle, Int32 chn, Int32 stream_type, Int32 type,
        [MarshalAs(UnmanagedType.FunctionPtr)] SDK_DETECT_CB detect_cb, IntPtr p_obj);

    // Chụp ảnh snapshot: sdk_open_snap(handle, channel, filepath)
    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern Int32 sdk_open_snap(UInt32 handle, Int32 channel,
        [MarshalAs(UnmanagedType.LPStr)] string p_file);

    // Chụp ảnh từ media stream: sdk_md_capture(md_handle, filepath)
    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern Int32 sdk_md_capture(UInt32 md_handle,
        [MarshalAs(UnmanagedType.LPStr)] string p_file);

    // Mở live stream (cần cho sdk_md_capture)
    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern UInt32 sdk_md_live_start(UInt32 handle, Int32 channel, Int32 stream_type,
        [MarshalAs(UnmanagedType.FunctionPtr)] SDK_LIVE_CB live_cb, IntPtr p_obj);

    [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    public static extern void sdk_md_live_stop(UInt32 md_handle);

    // === Static state ===
    public static Func<object, Task<object>> globalNodeCallback = null;
    private static UInt32 _deviceHandle = 0;
    private static UInt32 _mdHandle = 0; // media handle cho live stream (dùng để capture)
    private static string _snapshotDir = "";

    // Giữ reference delegate tránh GC
    private static SDK_DISCONN_CB _disconnCb = new SDK_DISCONN_CB(disconn_cb);
    private static SDK_ALARM_CB _alarmCb = new SDK_ALARM_CB(alarm_cb);
    private static SDK_LIVE_CB _liveCb = new SDK_LIVE_CB(live_cb);
    private static SDK_DETECT_CB _detectCb = new SDK_DETECT_CB(detect_cb);

    public static void disconn_cb(UInt32 handle, IntPtr p_obj, UInt32 type)
    {
        Console.WriteLine("[SDK] Disconnected from handle: " + handle);
    }

    public static void live_cb(UInt32 md_handle, UInt32 data_type, IntPtr p_data, UInt32 data_len, IntPtr p_obj)
    {
        // Không cần xử lý gì - chỉ cần stream chạy để capture được
    }

    public static void detect_cb(UInt32 handle, Int32 stream_id, ref IntPtr p_result, IntPtr p_data, IntPtr p_obj)
    {
        if (p_result == IntPtr.Zero) return;

        string json = Marshal.PtrToStringAnsi(p_result);
        if (string.IsNullOrEmpty(json)) return;

        Console.WriteLine("[C# DETECT] Nhan Face/LPR stream tu camera (handle: " + handle + ")");

        string snapshotBase64 = "";
        string snapshotPath = "";
        try
        {
            if (_deviceHandle > 0 && !string.IsNullOrEmpty(_snapshotDir))
            {
                string filename = "snap_detect_" + DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + ".jpg";
                snapshotPath = Path.Combine(_snapshotDir, filename);

                Int32 snapResult = -1;
                if (_mdHandle > 0)
                {
                    snapResult = sdk_md_capture(_mdHandle, snapshotPath);
                    Console.WriteLine("[SNAP DETECT] sdk_md_capture result = " + snapResult + " -> " + snapshotPath);
                }

                if (snapResult != 0)
                {
                    snapResult = sdk_open_snap(_deviceHandle, 0, snapshotPath);
                    Console.WriteLine("[SNAP DETECT] sdk_open_snap result = " + snapResult + " -> " + snapshotPath);
                }

                System.Threading.Thread.Sleep(200);

                if (File.Exists(snapshotPath) && new FileInfo(snapshotPath).Length > 0)
                {
                    byte[] imgBytes = File.ReadAllBytes(snapshotPath);
                    snapshotBase64 = Convert.ToBase64String(imgBytes);
                    Console.WriteLine("[SNAP DETECT] OK! Size = " + imgBytes.Length + " bytes");
                }
                else
                {
                    snapshotPath = "";
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("[SNAP ERROR DETECT] " + ex.Message);
        }

        if (globalNodeCallback != null)
        {
            var payload = new Dictionary<string, object>
            {
                { "handle", handle },
                { "rawJson", json },
                { "timestamp", DateTime.UtcNow.ToString("o") },
                { "source", "FACE_DETECT_STREAM" },
                { "snapshotBase64", snapshotBase64 },
                { "snapshotPath", snapshotPath }
            };

            Task.Run(async () => {
                try {
                    await globalNodeCallback(payload);
                } catch {}
            });
        }
    }

    public static void alarm_cb(UInt32 handle, ref IntPtr p_data, IntPtr p_obj)
    {
        if (p_data == IntPtr.Zero) return;

        string json = Marshal.PtrToStringAnsi(p_data);
        if (string.IsNullOrEmpty(json)) return;

        Console.WriteLine("[C# ALARM] Nhan data tu camera (handle: " + handle + ")");

        // Thử chụp snapshot khi có alarm
        string snapshotBase64 = "";
        string snapshotPath = "";
        try
        {
            if (_deviceHandle > 0 && !string.IsNullOrEmpty(_snapshotDir))
            {
                string filename = "snap_" + DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + ".jpg";
                snapshotPath = Path.Combine(_snapshotDir, filename);

                Int32 snapResult = -1;

                // Cách 1: Dùng sdk_md_capture nếu đang có live stream
                if (_mdHandle > 0)
                {
                    snapResult = sdk_md_capture(_mdHandle, snapshotPath);
                    Console.WriteLine("[SNAP] sdk_md_capture result = " + snapResult + " -> " + snapshotPath);
                }

                // Cách 2: Fallback về sdk_open_snap
                if (snapResult != 0)
                {
                    snapResult = sdk_open_snap(_deviceHandle, 0, snapshotPath);
                    Console.WriteLine("[SNAP] sdk_open_snap result = " + snapResult + " -> " + snapshotPath);
                }

                // Chờ một chút để file được ghi xong
                System.Threading.Thread.Sleep(200);

                // Đọc file ảnh thành base64 nếu tồn tại
                if (File.Exists(snapshotPath) && new FileInfo(snapshotPath).Length > 0)
                {
                    byte[] imgBytes = File.ReadAllBytes(snapshotPath);
                    snapshotBase64 = Convert.ToBase64String(imgBytes);
                    Console.WriteLine("[SNAP] OK! Size = " + imgBytes.Length + " bytes");
                }
                else
                {
                    Console.WriteLine("[SNAP] File khong ton tai hoac rong");
                    snapshotPath = "";
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("[SNAP ERROR] " + ex.Message);
        }

        // Gửi sang Node.js
        if (globalNodeCallback != null)
        {
            var payload = new Dictionary<string, object>
            {
                { "handle", handle },
                { "rawJson", json },
                { "timestamp", DateTime.UtcNow.ToString("o") },
                { "snapshotBase64", snapshotBase64 },
                { "snapshotPath", snapshotPath }
            };

            Task.Run(async () => {
                try {
                    await globalNodeCallback(payload);
                } catch (Exception e) {
                    Console.WriteLine("[C# -> Node Error] " + e.Message);
                }
            });
        }
    }

    // Edge-js entry point: Kết nối camera
    public async Task<object> Invoke(object input)
    {
        UInt32 handle = 0;
        try
        {
            var data = (IDictionary<string, object>)input;

            if (data.ContainsKey("action") && (string)data["action"] == "disconnect")
            {
                if (data.ContainsKey("handle"))
                {
                    UInt32 h = Convert.ToUInt32(data["handle"]);
                    if (h > 0)
                    {
                        sdk_dev_conn_close(h);
                        Console.WriteLine("[SDK] Da dong ket noi handle: " + h);
                        if (_deviceHandle == h) _deviceHandle = 0;
                        return new Dictionary<string, object> { { "success", true } };
                    }
                }
                return new Dictionary<string, object> { { "success", false }, { "error", "Invalid handle" } };
            }

            if (data.ContainsKey("onEvent")) {
                globalNodeCallback = (Func<object, Task<object>>)data["onEvent"];
            }

            string sdkDir = data.ContainsKey("sdkPath") ? (string)data["sdkPath"] : "";

            // Tạo thư mục snapshots
            _snapshotDir = data.ContainsKey("snapshotDir") ? (string)data["snapshotDir"] : Path.Combine(sdkDir, "snapshots");
            if (!Directory.Exists(_snapshotDir)) {
                Directory.CreateDirectory(_snapshotDir);
                Console.WriteLine("[SNAP] Tao thu muc: " + _snapshotDir);
            }

            // Nạp DLL theo đúng thứ tự
            if (!string.IsNullOrEmpty(sdkDir) && Directory.Exists(sdkDir)) {
                SetDllDirectory(sdkDir);
                string[] dllOrder = new string[] {
                    "libcrypto-3-x64.dll", "libssl-3-x64.dll", "sdk.dll", "Sdk_C_Sharp_Lib.dll"
                };
                foreach (var dll in dllOrder) {
                    string fullPath = Path.Combine(sdkDir, dll);
                    if (File.Exists(fullPath)) {
                        IntPtr h = LoadLibrary(fullPath);
                        Console.WriteLine("[DLL] Load " + dll + " -> " + (h != IntPtr.Zero ? "OK" : "FAIL"));
                    }
                }
            }

            string p_ip = (string)data["ip"];
            string p_user = (string)data["username"];
            string p_passwd = (string)data["password"];
            UInt16 port = Convert.ToUInt16(data["port"]);

            var response = new Dictionary<string, object>();

            Int32 initResult = sdk_dev_init("");
            Console.WriteLine("[SDK] sdk_dev_init result = " + initResult);

            Console.WriteLine("[SDK] Connecting to " + p_ip + ":" + port + " user=" + p_user);
            handle = sdk_dev_conn(p_ip, port, p_user, p_passwd, _disconnCb, IntPtr.Zero);
            Console.WriteLine("[SDK] sdk_dev_conn handle = " + handle);

            if (handle > 0)
            {
                _deviceHandle = handle;

                // Bắt đầu lắng nghe alarm
                sdk_dev_start_alarm(handle, _alarmCb, IntPtr.Zero);

                // Khởi động luồng Face/LPR Detection
                Int32 detectResult = sdks_dev_face_detect_start(handle, 1, 1, 4, _detectCb, IntPtr.Zero);
                Console.WriteLine("[SDK] sdks_dev_face_detect_start result = " + detectResult);

                // Lưu ý: sdk_md_live_start xung đột với alarm listener nên không mở ở đây

                response["online"] = true;
                response["status"] = "Online";
                response["handle"] = handle;
                response["snapshotDir"] = _snapshotDir;
                response["message"] = "Ket noi thanh cong! Alarm dang hoat dong.";
            }
            else
            {
                response["online"] = false;
                response["status"] = "Offline";
                response["message"] = "Handle = 0. Vui long kiem tra IP/Port/User/Pass.";
            }

            return response;
        }
        catch (Exception ex)
        {
            return new Dictionary<string, object> {
                { "online", false },
                { "error", "Loi C#: " + ex.Message }
            };
        }
    }
}