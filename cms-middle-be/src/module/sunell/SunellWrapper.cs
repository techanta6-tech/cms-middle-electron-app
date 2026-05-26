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
    // [DllImport(DLL_NAME, CharSet = CharSet.Ansi, CallingConvention = CallingConvention.Cdecl)]
    // public static extern Int32 sdk_open_snap(UInt32 handle, Int32 channel,
    //     [MarshalAs(UnmanagedType.LPStr)] string p_file);

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
    
    // Cache ảnh (giải quyết xung đột Race Condition giữa Motion và LPR)
    private static string _cachedSnapshotBase64 = "";
    private static string _cachedSnapshotPath = "";
    private static DateTime _lastCaptureTime = DateTime.MinValue;
    private static readonly object _captureLock = new object();

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

        // === CÁCH 1 (ƯU TIÊN): Đọc ảnh trực tiếp từ p_data pointer ===
        // Camera Sunell gửi kèm binary ảnh JPEG trong p_data, kích thước = PictureLen trong JSON
        try
        {
            if (p_data != IntPtr.Zero)
            {
                // Parse PictureLen từ JSON metadata
                int pictureLen = 0;
                try
                {
                    string searchKey = "\"PictureLen\":";
                    int idx = json.IndexOf(searchKey);
                    if (idx >= 0)
                    {
                        int start = idx + searchKey.Length;
                        int end = json.IndexOfAny(new char[] { ',', '}', ' ' }, start);
                        if (end > start)
                        {
                            string numStr = json.Substring(start, end - start).Trim();
                            int.TryParse(numStr, out pictureLen);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("[SNAP DETECT p_data] Error parsing PictureLen: " + ex.Message);
                }

                if (pictureLen > 0 && pictureLen < 50 * 1024 * 1024) // Safety: max 50MB
                {
                    byte[] imgBytes = new byte[pictureLen];
                    Marshal.Copy(p_data, imgBytes, 0, pictureLen);

                    // Kiểm tra JPEG header (FF D8 FF)
                    bool isJpeg = imgBytes.Length >= 3 && imgBytes[0] == 0xFF && imgBytes[1] == 0xD8 && imgBytes[2] == 0xFF;

                    if (isJpeg)
                    {
                        snapshotBase64 = Convert.ToBase64String(imgBytes);
                        Console.WriteLine("[SNAP DETECT] ✅ Extracted JPEG from p_data! Size = " + imgBytes.Length + " bytes");
                    }
                    else
                    {
                        // Log header bytes để debug
                        string headerHex = BitConverter.ToString(imgBytes, 0, Math.Min(16, imgBytes.Length));
                        Console.WriteLine("[SNAP DETECT] p_data header (not JPEG): " + headerHex);

                        // Thử tìm JPEG header trong data (có thể có offset header trước ảnh)
                        int jpegStart = -1;
                        int searchLimit = Math.Min(1024, imgBytes.Length - 3); // Tìm trong 1KB đầu
                        for (int i = 0; i < searchLimit; i++)
                        {
                            if (imgBytes[i] == 0xFF && imgBytes[i + 1] == 0xD8 && imgBytes[i + 2] == 0xFF)
                            {
                                jpegStart = i;
                                break;
                            }
                        }

                        if (jpegStart >= 0)
                        {
                            int jpegLen = imgBytes.Length - jpegStart;
                            byte[] jpegBytes = new byte[jpegLen];
                            Array.Copy(imgBytes, jpegStart, jpegBytes, 0, jpegLen);
                            snapshotBase64 = Convert.ToBase64String(jpegBytes);
                            Console.WriteLine("[SNAP DETECT] ✅ Found JPEG at offset " + jpegStart + "! Size = " + jpegLen + " bytes");
                        }
                        else
                        {
                            // Fallback: convert nguyên khối (có thể là format khác)
                            snapshotBase64 = Convert.ToBase64String(imgBytes);
                            Console.WriteLine("[SNAP DETECT] ⚠️ No JPEG header found, raw base64 size = " + imgBytes.Length + " bytes");
                        }
                    }

                    // Lưu file ảnh để debug (tùy chọn)
                    // File save is deferred to Node after event prefilter passes.
                    if (false && !string.IsNullOrEmpty(_snapshotDir) && !string.IsNullOrEmpty(snapshotBase64))
                    {
                        try
                        {
                            string filename = "snap_detect_" + DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + ".jpg";
                            snapshotPath = Path.Combine(_snapshotDir, filename);
                            File.WriteAllBytes(snapshotPath, imgBytes);
                            Console.WriteLine("[SNAP DETECT] Saved to: " + snapshotPath);
                        }
                        catch {}
                    }
                }
                else
                {
                    Console.WriteLine("[SNAP DETECT] PictureLen = " + pictureLen + " (invalid or not found in JSON)");
                }
            }
            else
            {
                Console.WriteLine("[SNAP DETECT] p_data is NULL — no image data from camera");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("[SNAP DETECT p_data] Error: " + ex.Message);
        }

        // === CÁCH 2 (FALLBACK): Chụp qua SDK nếu chưa extract được ảnh từ p_data ===
        // Supplemental SDK capture is deferred to Node after event prefilter passes.
        if (false && string.IsNullOrEmpty(snapshotBase64))
        {
            try
            {
                CaptureSnapshotWithCache(out snapshotBase64, out snapshotPath, "snap_detect_sdk");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[SNAP DETECT SDK FALLBACK] " + ex.Message);
            }
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

    private static void CaptureSnapshotWithCache(out string base64, out string path, string prefix)
    {
        base64 = "";
        path = "";

        lock (_captureLock)
        {
            // Kiểm tra cache xem có ảnh nào vừa chụp trong vòng 1.5 giây không (giải quyết Race Condition)
            if ((DateTime.Now - _lastCaptureTime).TotalSeconds <= 1.5 && !string.IsNullOrEmpty(_cachedSnapshotBase64))
            {
                base64 = _cachedSnapshotBase64;
                path = _cachedSnapshotPath;
                Console.WriteLine("[SNAP CACHE] Reused cached image (" + (DateTime.Now - _lastCaptureTime).TotalMilliseconds.ToString("F0") + "ms ago) for " + prefix);
                return;
            }

            // --- DEBUG: Trạng thái handle trước khi capture ---
            Console.WriteLine("[SNAP DEBUG] prefix=" + prefix
                + " | _deviceHandle=" + _deviceHandle
                + " | _mdHandle=" + _mdHandle
                + " | _snapshotDir=" + (_snapshotDir ?? "(null)"));

            if (_deviceHandle <= 0)
            {
                Console.WriteLine("[SNAP DEBUG] ABORT: _deviceHandle <= 0, camera chua ket noi hoac da disconnect");
                return;
            }
            if (string.IsNullOrEmpty(_snapshotDir))
            {
                Console.WriteLine("[SNAP DEBUG] ABORT: _snapshotDir rong, chua set snapshotDir");
                return;
            }

            string filename = prefix + "_" + DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + ".jpg";
            string tempPath = Path.Combine(_snapshotDir, filename);
            Int32 snapResult = -1;

            // === BƯỚC 1: Thử chụp qua live stream handle (ưu tiên) ===
            bool mdHandleValid = _mdHandle > 0 && _mdHandle != 0xFFFFFFFF;
            if (mdHandleValid)
            {
                snapResult = sdk_md_capture(_mdHandle, tempPath);
                Console.WriteLine("[SNAP] sdk_md_capture result = " + snapResult + " | path = " + tempPath);

                if (snapResult != 0)
                {
                    Console.WriteLine("[SNAP] sdk_md_capture FAILED (result=" + snapResult + ")");
                }
            }
            else
            {
                Console.WriteLine("[SNAP] _mdHandle = " + _mdHandle + " (invalid/0xFFFFFFFF) — bo qua sdk_md_capture");
            }

            // === BƯỚC 2: Fallback dùng sdk_open_snap nếu md_capture thất bại ===
            /*
            if (snapResult != 0)
            {
                // Chỉ dùng channel 0 (channel 1 gây AccessViolationException trên một số model Sunell)
                for (int attempt = 1; attempt <= 2 && snapResult != 0; attempt++)
                {
                    if (attempt > 1) System.Threading.Thread.Sleep(300);
                    snapResult = sdk_open_snap(_deviceHandle, 0, tempPath);
                    Console.WriteLine("[SNAP] sdk_open_snap attempt #" + attempt + " result = " + snapResult + " | path = " + tempPath);
                }

                if (snapResult != 0)
                {
                    Console.WriteLine("[SNAP] sdk_open_snap FAILED sau 2 lan thu (result=" + snapResult + ") — SDK co the chua san sang");
                }
            }
            */

            // === BƯỚC 3: Polling loop chờ file được ghi (SDK ghi bất đồng bộ) ===
            // Thay thế Thread.Sleep(200) cố định bằng polling tối đa 2 giây
            bool fileReady = false;
            int totalWaitedMs = 0;
            const int pollIntervalMs = 100;
            const int maxWaitMs = 2000;

            while (totalWaitedMs < maxWaitMs)
            {
                System.Threading.Thread.Sleep(pollIntervalMs);
                totalWaitedMs += pollIntervalMs;

                if (File.Exists(tempPath))
                {
                    long fileSize = new FileInfo(tempPath).Length;
                    if (fileSize > 0)
                    {
                        Console.WriteLine("[SNAP] File da san sang sau " + totalWaitedMs + "ms, size = " + fileSize + " bytes");
                        fileReady = true;
                        break;
                    }
                    // File tồn tại nhưng vẫn đang ghi (size = 0) → tiếp tục chờ
                    Console.WriteLine("[SNAP] File ton tai nhung size = 0 (dang ghi), tiep tuc cho... (" + totalWaitedMs + "ms)");
                }
            }

            if (!fileReady)
            {
                Console.WriteLine("[SNAP CAPTURE FAIL] Timeout sau " + maxWaitMs + "ms: file khong xuat hien hoac rong"
                    + " | snapResult=" + snapResult
                    + " | path=" + tempPath
                    + " | snapshotDir exists=" + Directory.Exists(_snapshotDir));
                return;
            }

            // === BƯỚC 4: Đọc file và encode Base64 ===
            try
            {
                byte[] imgBytes = File.ReadAllBytes(tempPath);
                base64 = Convert.ToBase64String(imgBytes);
                path = tempPath;

                // Cập nhật cache
                _cachedSnapshotBase64 = base64;
                _cachedSnapshotPath = path;
                _lastCaptureTime = DateTime.Now;

                Console.WriteLine("[SNAP CAPTURE] OK! Size = " + imgBytes.Length + " bytes | waited = " + totalWaitedMs + "ms | path = " + path);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[SNAP CAPTURE] Loi doc file: " + ex.Message);
            }
        }
    }


    public static void alarm_cb(UInt32 handle, ref IntPtr p_data, IntPtr p_obj)
    {
        if (p_data == IntPtr.Zero) return;

        string json = Marshal.PtrToStringAnsi(p_data);
        if (string.IsNullOrEmpty(json)) return;

        // --- DEBUG: Parse main_type/sub_type/alarm_flag ngay tại đây để log rõ ---
        string alarmInfo = "";
        try
        {
            // Extract main_type, sub_type, alarm_flag từ JSON (không cần full parse)
            string mainTypeStr = ExtractJsonInt(json, "main_type");
            string subTypeStr  = ExtractJsonInt(json, "sub_type");
            string flagStr     = ExtractJsonInt(json, "alarm_flag");
            alarmInfo = "main_type=" + mainTypeStr + " sub_type=" + subTypeStr + " alarm_flag=" + flagStr;
        }
        catch { alarmInfo = "(parse error)"; }

        Console.WriteLine("[C# ALARM] Nhan data tu camera | handle=" + handle
            + " | " + alarmInfo
            + " | _deviceHandle=" + _deviceHandle
            + " | _mdHandle=" + _mdHandle);

        // Chỉ chụp ảnh khi alarm_flag = 1 (bắt đầu báo động), bỏ qua flag=0 (kết thúc)
        string snapshotBase64 = "";
        string snapshotPath = "";

        // Alarm snapshot capture is disabled here; Node decides after event prefilter.
        bool shouldCapture = false;
        try
        {
            string flagVal = ExtractJsonInt(json, "alarm_flag");
            if (flagVal == "0")
            {
                shouldCapture = false;
                Console.WriteLine("[C# ALARM] alarm_flag=0 (alarm ended) — bo qua chup anh");
            }
        }
        catch { /* Nếu không parse được flag thì vẫn chụp */ }

        if (shouldCapture)
        {
            try
            {
                Console.WriteLine("[C# ALARM] Bat dau chup snapshot cho alarm...");
                CaptureSnapshotWithCache(out snapshotBase64, out snapshotPath, "snap_alarm");

                if (!string.IsNullOrEmpty(snapshotBase64))
                    Console.WriteLine("[C# ALARM] ✅ Snapshot OK! base64 length = " + snapshotBase64.Length);
                else
                    Console.WriteLine("[C# ALARM] ❌ Snapshot EMPTY sau CaptureSnapshotWithCache");
            }
            catch (Exception ex)
            {
                Console.WriteLine("[C# ALARM SNAP ERROR] " + ex.Message + "\n" + ex.StackTrace);
            }
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

    /// <summary>
    /// Helper: Extract giá trị integer từ JSON string thô (không cần full parse)
    /// Ví dụ: ExtractJsonInt(json, "main_type") → "6"
    /// </summary>
    private static string ExtractJsonInt(string json, string key)
    {
        string searchKey = "\"" + key + "\":";
        int idx = json.IndexOf(searchKey);
        if (idx < 0) return "?";
        int start = idx + searchKey.Length;
        // Bỏ qua khoảng trắng
        while (start < json.Length && json[start] == ' ') start++;
        int end = start;
        while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-')) end++;
        return end > start ? json.Substring(start, end - start) : "?";
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

            if (data.ContainsKey("action") && (string)data["action"] == "captureSnapshotSdk")
            {
                if (data.ContainsKey("snapshotDir"))
                {
                    _snapshotDir = (string)data["snapshotDir"];
                    if (!Directory.Exists(_snapshotDir)) {
                        Directory.CreateDirectory(_snapshotDir);
                    }
                }

                string snapshotBase64 = "";
                string snapshotPath = "";
                string prefix = data.ContainsKey("prefix") ? (string)data["prefix"] : "snap_manual_sdk";
                bool forceFresh = data.ContainsKey("forceFresh") && Convert.ToBoolean(data["forceFresh"]);

                try
                {
                    if (forceFresh)
                    {
                        _cachedSnapshotBase64 = "";
                        _cachedSnapshotPath = "";
                        _lastCaptureTime = DateTime.MinValue;
                    }
                    CaptureSnapshotWithCache(out snapshotBase64, out snapshotPath, prefix);
                }
                catch (Exception ex)
                {
                    return new Dictionary<string, object> {
                        { "success", false },
                        { "error", "SDK snapshot error: " + ex.Message }
                    };
                }

                return new Dictionary<string, object> {
                    { "success", !string.IsNullOrEmpty(snapshotBase64) },
                    { "snapshotBase64", snapshotBase64 },
                    { "snapshotPath", snapshotPath },
                    { "handle", _deviceHandle },
                    { "mdHandle", _mdHandle },
                    { "error", string.IsNullOrEmpty(snapshotBase64) ? "SDK snapshot returned empty image" : "" }
                };
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

                // Mở live stream để có thể dùng sdk_md_capture chụp ảnh (alarm không gửi kèm ảnh)
                // Delay 500ms để tránh xung đột khi alarm listener vừa khởi động xong
                System.Threading.Thread.Sleep(500);
                UInt32 mdHandle = sdk_md_live_start(handle, 1, 0, _liveCb, IntPtr.Zero);
                if (mdHandle > 0 && mdHandle != 0xFFFFFFFF)
                {
                    _mdHandle = mdHandle;
                    Console.WriteLine("[SDK] sdk_md_live_start OK, md_handle = " + mdHandle);
                }
                else
                {
                    _mdHandle = 0; // Reset ve 0 de CaptureSnapshotWithCache dung sdk_open_snap fallback
                    Console.WriteLine("[SDK] sdk_md_live_start FAILED (md_handle = " + mdHandle + ") — alarm snapshot se dung sdk_open_snap fallback");
                }

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
