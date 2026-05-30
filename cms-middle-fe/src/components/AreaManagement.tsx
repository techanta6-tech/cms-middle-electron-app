/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Folder, 
  FolderPlus, 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  Trash2, 
  Edit3, 
  Camera, 
  Radio, 
  Cpu, 
  Search, 
  X, 
  Save, 
  Layers, 
  Building2, 
  Network, 
  Eye, 
  FileText,
  Activity,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/apiClient';

export interface AreaNode {
  id: string;
  name: string;
  type: 'group' | 'svms-device' | 'sunell-camera' | 'mqtt-sensor';
  parentId: string | null;
  ip?: string;
  port?: string;
  vendor?: string;
  devEui?: string;
}

const DEFAULT_AREA_NODES: AreaNode[] = [
  { id: 'g-root-south', name: 'Khu vực Miền Nam', type: 'group', parentId: null },
  { id: 'g-root-north', name: 'Khu vực Miền Bắc', type: 'group', parentId: null },
  { id: 'g-sub-hcm', name: 'Tòa nhà văn phòng HCM', type: 'group', parentId: 'g-root-south' },
  { id: 'g-sub-hn', name: 'Nhà máy Hà Nội', type: 'group', parentId: 'g-root-north' },
  { id: 'dev-1', name: 'SVMS Camera Lối Vào', type: 'svms-device', parentId: 'g-sub-hcm', ip: '192.168.1.100', port: '80', vendor: 'Hikvision' },
  { id: 'dev-2', name: 'Sunell Camera Bãi Xe', type: 'sunell-camera', parentId: 'g-sub-hcm', ip: '192.168.1.150' },
  { id: 'dev-3', name: 'MQTT Radar Hàng Rào', type: 'mqtt-sensor', parentId: 'g-sub-hn', devEui: '24e124707c229983', vendor: 'Milesight' }
];

interface AreaManagementProps {
  servers?: Record<string, any>;
  devices?: Record<string, any>;
  mqttServers?: any[];
  mqttGroups?: any[];
  mqttDevicesByServer?: Record<string, any[]>;
  cameraDevices?: any[];
}

export function AreaManagement({
  servers = {},
  devices = {},
  mqttServers = [],
  mqttGroups = [],
  mqttDevicesByServer = {},
  cameraDevices = []
}: AreaManagementProps) {
  const { t } = useTranslation();

  // Load state from localStorage or seed default data
  const [nodes, setNodes] = useState<AreaNode[]>(() => {
    const saved = localStorage.getItem('CMS_AREA_NODES');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved area nodes', e);
      }
    }
    return DEFAULT_AREA_NODES;
  });

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem('CMS_AREA_NODES', JSON.stringify(nodes));
  }, [nodes]);

  // Selected item and search
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(['g-root-south', 'g-root-north']));

  // Modal Panel state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addType, setAddType] = useState<'group' | 'svms-device' | 'sunell-camera' | 'mqtt-sensor'>('group');
  const [addName, setAddName] = useState('');
  const [addParentId, setAddParentId] = useState<string>('none');
  
  // Selection states for modal lists
  const [selectedModalItems, setSelectedModalItems] = useState<Set<string>>(new Set());
  const [expandedModalParents, setExpandedModalParents] = useState<Set<string>>(new Set());

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editParentId, setEditParentId] = useState<string>('none');
  const [editIp, setEditIp] = useState('');
  const [editPort, setEditPort] = useState('');
  const [editVendor, setEditVendor] = useState('');
  const [editDevEui, setEditDevEui] = useState('');

  // Extract selected node details
  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // Find matched camera RTSP URL if any
  const selectedNodeRtspUrl = useMemo(() => {
    if (!selectedNode) return null;

    // 1. Check if we can match it in cameraDevices (by id or IP)
    const matched = cameraDevices.find(c => 
      c.id === selectedNode.id || 
      (selectedNode.ip && (c.cameraIp === selectedNode.ip || c.ip === selectedNode.ip))
    );
    if (matched?.rtspUrl) return matched.rtspUrl;

    // 2. Fallback: if it's a sunell-camera and has IP, construct default RTSP URL
    if (selectedNode.type === 'sunell-camera' && selectedNode.ip) {
      return `rtsp://admin:admin1234@${selectedNode.ip}:554/snl/live/1/1`;
    }

    return null;
  }, [selectedNode, cameraDevices]);

  // All group nodes for dropdown selection
  const groupNodes = useMemo(() => {
    return nodes.filter(n => n.type === 'group');
  }, [nodes]);

  // Initialize edit fields when selected node changes
  useEffect(() => {
    if (selectedNode) {
      setEditName(selectedNode.name);
      setEditParentId(selectedNode.parentId || 'none');
      setEditIp(selectedNode.ip || '');
      setEditPort(selectedNode.port || '80');
      setEditVendor(selectedNode.vendor || '');
      setEditDevEui(selectedNode.devEui || '');
      setIsEditing(false);
    }
  }, [selectedNode]);

  // Toggle group expansion state
  const toggleGroupExpand = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedGroups(prev => {
      const s = new Set(prev);
      if (s.has(groupId)) s.delete(groupId); else s.add(groupId);
      return s;
    });
  };

  const toggleModalItemSelection = (key: string) => {
    setSelectedModalItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleModalParentExpand = (id: string) => {
    setExpandedModalParents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Add new item (group or multi-selected devices)
  const handleSubmitModal = (e: React.FormEvent) => {
    e.preventDefault();

    if (addType === 'group') {
      if (!addName.trim()) return;
      const newId = `group-${Date.now()}`;
      const newNode: AreaNode = {
        id: newId,
        name: addName.trim(),
        type: 'group',
        parentId: addParentId === 'none' ? null : addParentId,
      };
      setNodes(prev => [...prev, newNode]);
      if (addParentId !== 'none') {
        setExpandedGroups(prev => new Set([...prev, addParentId]));
      }
      setAddName('');
      setIsAddModalOpen(false);
      setSelectedNodeId(newId);
    } else {
      // Add all selected devices from the modal picker
      if (selectedModalItems.size === 0) {
        alert('Vui lòng chọn ít nhất một thiết bị để thêm!');
        return;
      }

      const newNodes: AreaNode[] = [];
      selectedModalItems.forEach(key => {
        const parts = key.split('::');
        const dType = parts[0];
        
        if (dType === 'svms') {
          const serverId = parts[1];
          const ip = parts[2];
          const name = parts[3];
          newNodes.push({
            id: `svms-device-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: name,
            type: 'svms-device',
            parentId: addParentId === 'none' ? null : addParentId,
            ip: ip,
            port: '80',
            vendor: 'SVMS Server'
          });
        } else if (dType === 'mqtt') {
          const groupId = parts[1];
          const devEui = parts[2];
          const name = parts[3];
          newNodes.push({
            id: `mqtt-sensor-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: name,
            type: 'mqtt-sensor',
            parentId: addParentId === 'none' ? null : addParentId,
            devEui: devEui,
            vendor: 'Milesight'
          });
        } else if (dType === 'sunell') {
          const id = parts[1];
          const ip = parts[2];
          const name = parts[3];
          newNodes.push({
            id: `sunell-camera-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: name,
            type: 'sunell-camera',
            parentId: addParentId === 'none' ? null : addParentId,
            ip: ip
          });
        }
      });

      setNodes(prev => [...prev, ...newNodes]);
      
      if (addParentId !== 'none') {
        setExpandedGroups(prev => new Set([...prev, addParentId]));
      }

      setSelectedModalItems(new Set());
      setIsAddModalOpen(false);
    }
  };

  // Save edited item
  const handleSaveEdit = () => {
    if (!selectedNodeId || !editName.trim()) return;

    setNodes(prev => prev.map(n => {
      if (n.id === selectedNodeId) {
        return {
          ...n,
          name: editName.trim(),
          parentId: editParentId === 'none' ? null : editParentId,
          ...(n.type === 'svms-device' && { ip: editIp.trim(), port: editPort.trim(), vendor: editVendor.trim() }),
          ...(n.type === 'sunell-camera' && { ip: editIp.trim() }),
          ...(n.type === 'mqtt-sensor' && { devEui: editDevEui.trim(), vendor: editVendor.trim() }),
        };
      }
      return n;
    }));
    setIsEditing(false);
  };

  // Delete item and its recursive children
  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Bạn có chắc chắn muốn xóa thiết bị hoặc nhóm này cùng toàn bộ thiết bị con bên trong?')) return;

    const idsToDelete = new Set<string>([id]);
    
    // Recursive search for all descendant nodes
    let searchCount = 0;
    while (searchCount < nodes.length) {
      let addedAny = false;
      nodes.forEach(n => {
        if (n.parentId && idsToDelete.has(n.parentId) && !idsToDelete.has(n.id)) {
          idsToDelete.add(n.id);
          addedAny = true;
        }
      });
      if (!addedAny) break;
      searchCount++;
    }

    setNodes(prev => prev.filter(n => !idsToDelete.has(n.id)));
    if (selectedNodeId && idsToDelete.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  };

  // Build root nodes list
  const rootNodes = useMemo(() => {
    return nodes.filter(n => n.parentId === null);
  }, [nodes]);

  // Recursively render node trees in sidebar with gorgeous nesting guide lines
  const renderTreeItem = (node: AreaNode, depth: number = 0) => {
    const children = nodes.filter(n => n.parentId === node.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedGroups.has(node.id);
    const isSelected = selectedNodeId === node.id;

    // Filter logic based on search
    const matchesSearch = node.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (node.ip && node.ip.includes(searchQuery)) ||
                          (node.devEui && node.devEui.includes(searchQuery));

    // Check if any descendant matches search
    const hasMatchingDescendant = (n: AreaNode): boolean => {
      const directChildren = nodes.filter(child => child.parentId === n.id);
      return directChildren.some(child => 
        child.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (child.ip && child.ip.includes(searchQuery)) ||
        (child.devEui && child.devEui.includes(searchQuery)) ||
        hasMatchingDescendant(child)
      );
    };

    if (searchQuery && !matchesSearch && !hasMatchingDescendant(node)) {
      return null;
    }

    let nodeIcon = <Folder className="w-4 h-4 text-warning shrink-0" />;
    if (node.type === 'svms-device' || node.type === 'sunell-camera') {
      nodeIcon = <Camera className="w-4 h-4 text-primary shrink-0" />;
    } else if (node.type === 'mqtt-sensor') {
      nodeIcon = <Radio className="w-4 h-4 text-tertiary shrink-0" />;
    }

    return (
      <div key={node.id} className="flex flex-col">
        {/* Row element */}
        <div
          onClick={() => setSelectedNodeId(node.id)}
          className={`group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer select-none transition-all duration-200 border ${
            isSelected 
              ? 'bg-primary/10 border-primary text-primary shadow-sm shadow-primary/5' 
              : 'border-transparent text-on-surface hover:bg-surface-container hover:text-white'
          }`}
          style={{ paddingLeft: `${Math.max(12, depth * 16)}px` }}
        >
          {node.type === 'group' ? (
            <button
              onClick={(e) => toggleGroupExpand(node.id, e)}
              className="p-0.5 hover:bg-surface-container-high rounded transition-colors shrink-0 text-on-surface-variant"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <div className="w-4 h-4 shrink-0" />
          )}

          {nodeIcon}

          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-semibold truncate leading-tight">{node.name}</span>
            {node.type !== 'group' && (
              <span className="text-[9px] font-mono text-on-surface-variant/70 leading-none truncate mt-0.5">
                {node.type === 'mqtt-sensor' ? `EUI: ${node.devEui || 'N/A'}` : `IP: ${node.ip || 'N/A'}`}
              </span>
            )}
          </div>

          {/* Quick Actions Hover button */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
            {node.type === 'group' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAddParentId(node.id);
                  setIsAddModalOpen(true);
                }}
                title="Thêm thiết bị con"
                className="p-1 hover:bg-primary/20 rounded text-primary transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={(e) => handleDeleteItem(node.id, e)}
              title="Xóa"
              className="p-1 hover:bg-error/20 rounded text-error transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Render child elements */}
        {node.type === 'group' && isExpanded && hasChildren && (
          <div className="flex flex-col relative border-l border-outline-variant/10 ml-5 pl-1.5 py-0.5 mt-0.5">
            {children.map(child => renderTreeItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="AreaManagement flex flex-col flex-1 h-full min-h-0 bg-background relative">
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.9fr] gap-4 flex-1 min-h-0 overflow-hidden">
        
        {/* SIDEBAR LEFT */}
        <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl overflow-hidden flex flex-col shadow-xl min-h-0">
          
          {/* Header & Plus Button */}
          <div className="flex items-center justify-between bg-surface-container-high/50 px-4 py-3 border-b border-outline-variant/20">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-widest text-primary">Sơ đồ khu vực</span>
            </div>
            
            <button
              onClick={() => {
                setAddParentId('none');
                setIsAddModalOpen(true);
              }}
              title="Thêm khu vực hoặc thiết bị"
              className="p-1.5 bg-primary text-on-primary hover:bg-primary-hover active:scale-95 rounded-lg flex items-center justify-center shadow transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick search input */}
          <div className="p-3 border-b border-outline-variant/10 bg-surface-container-lowest/30">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm khu vực, thiết bị..."
                className="w-full bg-background border border-outline-variant/30 rounded-xl pl-8 pr-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Hierarchical Tree List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-1.5">
            {rootNodes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-40 py-10 gap-2 text-center">
                <Building2 className="w-10 h-10 text-on-surface-variant/60" />
                <span className="text-xs uppercase font-bold tracking-widest">Chưa cấu hình khu vực</span>
                <button
                  onClick={() => setNodes(DEFAULT_AREA_NODES)}
                  className="mt-2 text-[10px] bg-primary/10 hover:bg-primary/20 text-primary font-bold px-3 py-1.5 rounded-lg tracking-wider uppercase border border-primary/20"
                >
                  Khôi phục dữ liệu mẫu
                </button>
              </div>
            ) : (
              rootNodes.map(rootNode => renderTreeItem(rootNode, 0))
            )}
          </div>
        </div>

        {/* MAIN AREA RIGHT */}
        <div className="flex flex-col min-h-0 overflow-hidden bg-surface-container-low border border-outline-variant/20 rounded-2xl shadow-xl">
          {selectedNode ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar p-6">
              
              {/* Node Header */}
              <div className="flex items-start justify-between border-b border-outline-variant/10 pb-4 mb-6">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold ${
                      selectedNode.type === 'group' ? 'bg-warning/15 text-warning border border-warning/20' :
                      selectedNode.type === 'svms-device' ? 'bg-primary/15 text-primary border border-primary/20' :
                      selectedNode.type === 'sunell-camera' ? 'bg-secondary/15 text-secondary border border-secondary/20' :
                      'bg-tertiary/15 text-tertiary border border-tertiary/20'
                    }`}>
                      {selectedNode.type === 'group' ? 'Nhóm / Khu vực' :
                       selectedNode.type === 'svms-device' ? 'Thiết bị SVMS' :
                       selectedNode.type === 'sunell-camera' ? 'Camera Sunell' :
                       'Cảm biến/Radar MQTT'}
                    </span>
                  </div>
                  <h1 className="text-xl font-extrabold text-white tracking-wide mt-2">{selectedNode.name}</h1>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all border ${
                      isEditing 
                        ? 'bg-surface-container border-outline-variant text-on-surface' 
                        : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20'
                    }`}
                  >
                    {isEditing ? <X className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                    {isEditing ? 'Hủy' : 'Chỉnh sửa'}
                  </button>
                </div>
              </div>

              {/* Editing Form or Static details */}
              {isEditing ? (
                <div className="flex flex-col gap-4 bg-surface-container-high/40 p-5 rounded-2xl border border-outline-variant/10 mb-6 max-w-xl">
                  <h3 className="text-xs font-bold text-primary uppercase tracking-widest mb-2 border-b border-primary/10 pb-1">Cấu hình chi tiết</h3>
                  
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Tên phần tử</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Thuộc Nhóm/Khu vực</label>
                    <select
                      value={editParentId}
                      onChange={e => setEditParentId(e.target.value)}
                      className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                    >
                      <option value="none">Không có (Cấp Gốc)</option>
                      {groupNodes.filter(g => g.id !== selectedNode.id).map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>

                  {selectedNode.type === 'svms-device' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Địa chỉ IP</label>
                        <input
                          type="text"
                          value={editIp}
                          onChange={e => setEditIp(e.target.value)}
                          className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Cổng (Port)</label>
                        <input
                          type="text"
                          value={editPort}
                          onChange={e => setEditPort(e.target.value)}
                          className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                        />
                      </div>
                    </div>
                  )}

                  {selectedNode.type === 'sunell-camera' && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Địa chỉ IP</label>
                      <input
                        type="text"
                        value={editIp}
                        onChange={e => setEditIp(e.target.value)}
                        className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  )}

                  {selectedNode.type === 'mqtt-sensor' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Mã DevEUI</label>
                        <input
                          type="text"
                          value={editDevEui}
                          onChange={e => setEditDevEui(e.target.value)}
                          className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Hãng/Vendor</label>
                        <input
                          type="text"
                          value={editVendor}
                          onChange={e => setEditVendor(e.target.value)}
                          className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                        />
                      </div>
                    </div>
                  )}

                  {selectedNode.type === 'svms-device' && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Nhà sản xuất</label>
                      <input
                        type="text"
                        value={editVendor}
                        onChange={e => setEditVendor(e.target.value)}
                        className="bg-background border border-outline-variant/30 rounded-xl px-3 py-2 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  )}

                  <button
                    onClick={handleSaveEdit}
                    className="flex items-center justify-center gap-2 mt-2 px-4 py-2.5 bg-primary text-on-primary hover:bg-primary-hover active:scale-95 font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow"
                  >
                    <Save className="w-4 h-4" />
                    Lưu cấu hình
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {/* Detailed card specs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    
                    {selectedNode.type === 'group' ? (
                      <>
                        <div className="p-4 bg-surface-container border border-outline-variant/10 rounded-2xl flex flex-col gap-1 shadow-sm">
                          <span className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">Tổng thiết bị con</span>
                          <span className="text-2xl font-black text-white">{nodes.filter(n => n.parentId === selectedNode.id).length}</span>
                        </div>
                        <div className="p-4 bg-surface-container border border-outline-variant/10 rounded-2xl flex flex-col gap-1 shadow-sm">
                          <span className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">Thuộc phân vùng</span>
                          <span className="text-xs font-semibold text-white truncate mt-1">
                            {nodes.find(n => n.id === selectedNode.parentId)?.name || 'Cấp Gốc (Root)'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-4 bg-surface-container border border-outline-variant/10 rounded-2xl flex flex-col gap-1 shadow-sm">
                          <span className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">IP / Địa chỉ</span>
                          <span className="text-sm font-semibold text-white truncate mt-1">{selectedNode.ip || selectedNode.devEui || 'N/A'}</span>
                        </div>
                        {selectedNode.port && (
                          <div className="p-4 bg-surface-container border border-outline-variant/10 rounded-2xl flex flex-col gap-1 shadow-sm">
                            <span className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">Cổng kết nối</span>
                            <span className="text-sm font-semibold text-white mt-1">{selectedNode.port}</span>
                          </div>
                        )}
                        <div className="p-4 bg-surface-container border border-outline-variant/10 rounded-2xl flex flex-col gap-1 shadow-sm">
                          <span className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold">Nhóm quản lý</span>
                          <span className="text-sm font-semibold text-white truncate mt-1">
                            {nodes.find(n => n.id === selectedNode.parentId)?.name || 'Chưa phân nhóm'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Subgroup/device list representation */}
                  {selectedNode.type === 'group' && (
                    <div className="flex flex-col gap-3">
                      <h2 className="text-xs font-black uppercase text-primary tracking-widest border-b border-outline-variant/10 pb-2">Danh sách thành viên</h2>
                      {nodes.filter(n => n.parentId === selectedNode.id).length === 0 ? (
                        <div className="p-6 text-center italic text-xs text-on-surface-variant/40 bg-surface-container-high/20 rounded-2xl border border-outline-variant/10">
                          Khu vực này hiện tại đang trống. Click nút chỉnh sửa để thêm thiết bị hoặc nhóm vào đây.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {nodes.filter(n => n.parentId === selectedNode.id).map(cNode => (
                            <div
                              key={cNode.id}
                              onClick={() => setSelectedNodeId(cNode.id)}
                              className="p-4 bg-surface-container hover:bg-surface-container-high border border-outline-variant/15 hover:border-primary/45 rounded-2xl cursor-pointer flex items-center justify-between transition-all group"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2.5 bg-surface-container-highest rounded-xl text-primary">
                                  {cNode.type === 'group' ? <Folder className="w-4 h-4 text-warning" /> :
                                   cNode.type === 'mqtt-sensor' ? <Radio className="w-4 h-4 text-tertiary" /> :
                                   <Camera className="w-4 h-4 text-primary" />}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs font-bold text-white group-hover:text-primary transition-colors truncate">{cNode.name}</span>
                                  <span className="text-[10px] text-on-surface-variant/75 mt-0.5 uppercase tracking-wide">
                                    {cNode.type === 'group' ? 'Phân khu' : cNode.type}
                                  </span>
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-on-surface-variant/60 group-hover:text-primary transition-colors shrink-0" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Simulated Activity Stream Panel */}
                  {selectedNode.type !== 'group' && (
                    <div className="flex flex-col gap-3 mt-4">
                      <h2 className="text-xs font-black uppercase text-primary tracking-widest border-b border-outline-variant/10 pb-2">Luồng hoạt động giả lập</h2>
                      {selectedNodeRtspUrl ? (
                        <div className="flex flex-col gap-3">
                          <AreaLivePlayer 
                            cameraId={selectedNode.id} 
                            cameraName={selectedNode.name} 
                            rtspUrl={selectedNodeRtspUrl} 
                            cameraIp={selectedNode.ip} 
                          />
                          <div className="p-3 bg-surface-container border border-outline-variant/10 rounded-xl flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <Activity className="w-3.5 h-3.5 text-success shrink-0" />
                              <span className="font-semibold text-white">Đang phát luồng camera thực tế</span>
                            </div>
                            <span className="text-[9px] font-mono text-on-surface-variant/80 select-all truncate max-w-[200px]">{selectedNodeRtspUrl}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8 bg-surface-container-high/20 rounded-2xl border border-outline-variant/10 flex flex-col items-center justify-center text-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-success/15 text-success border border-success/20 flex items-center justify-center animate-pulse">
                            <Eye className="w-6 h-6" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white">Thiết bị đang hoạt động</span>
                            <span className="text-[10px] text-on-surface-variant/70 mt-0.5">Mọi trạng thái kết nối và ping TCP đều bình thường</span>
                          </div>
                          <div className="mt-2 p-3 bg-surface-container/60 border border-outline-variant/5 rounded-xl font-mono text-[9px] text-left text-success w-full max-w-md flex gap-2">
                            <FileText className="w-4 h-4 shrink-0" />
                            <div className="flex-1 overflow-hidden truncate">
                              [PING OK] {new Date().toISOString()} - Response in 12ms. Device model {selectedNode.vendor || 'Generic'}.
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-40 p-10 text-center select-none">
              <Network className="w-12 h-12 text-primary/70 shrink-0 mb-3 animate-bounce" />
              <span className="text-xs font-extrabold uppercase tracking-widest">Chọn một khu vực hoặc thiết bị</span>
              <span className="text-[10px] text-on-surface-variant/80 mt-1 max-w-xs">Chọn bất cứ mục nào bên sơ đồ cây của sidebar trái để xem cấu hình chi tiết hoặc thực hiện hiệu chỉnh</span>
            </div>
          )}
        </div>
      </div>

      {/* JOINT ADD PANEL MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-container-high border border-outline-variant rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between bg-surface-container-highest px-5 py-4 border-b border-outline-variant/20">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-primary shrink-0" />
                <span className="text-sm font-extrabold text-white uppercase tracking-wider">Thêm mới khu vực / Thiết bị</span>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 hover:bg-surface-container rounded-lg text-on-surface-variant hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body / Dynamic Form */}
            <form onSubmit={handleSubmitModal} className="p-5 flex flex-col gap-4">
              
              {/* Selection Dropdown select item type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Loại phần tử cần thêm</label>
                <select
                  value={addType}
                  onChange={e => {
                    setAddType(e.target.value as any);
                    setSelectedModalItems(new Set()); // Reset selection when type changes
                  }}
                  className="w-full bg-background border border-outline-variant/30 rounded-xl px-3 py-2.5 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary/50"
                >
                  <option value="group">📁 Nhóm / Khu Vực (Group)</option>
                  <option value="svms-device">📹 SVMS Camera/Thiết bị</option>
                  <option value="sunell-camera">📹 Sunell Camera</option>
                  <option value="mqtt-sensor">📡 MQTT Radar/Cảm biến</option>
                </select>
              </div>

              {/* Parent group selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Thuộc Nhóm/Khu vực</label>
                <select
                  value={addParentId}
                  onChange={e => setAddParentId(e.target.value)}
                  className="w-full bg-background border border-outline-variant/30 rounded-xl px-3 py-2.5 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                >
                  <option value="none">Không có (Cấp Gốc / Root)</option>
                  {groupNodes.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              {/* DYNAMIC CONTENTS depending on addType */}

              {addType === 'group' ? (
                /* Element Name */
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Tên hiển thị nhóm</label>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Tòa nhà Văn phòng, Bãi đỗ xe..."
                    value={addName}
                    onChange={e => setAddName(e.target.value)}
                    className="w-full bg-background border border-outline-variant/30 rounded-xl px-3 py-2.5 text-xs text-on-surface focus:outline-none focus:border-primary/50"
                  />
                </div>
              ) : (
                /* Dynamic Lists Picker */
                <div className="flex flex-col gap-2">
                  {addType === 'svms-device' && (
                    <div className="flex flex-col gap-2 border-t border-outline-variant/10 pt-3 mt-1">
                      <span className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Chọn thiết bị SVMS ({selectedModalItems.size} đã chọn)</span>
                      <div className="flex flex-col gap-2 max-h-60 overflow-y-auto custom-scrollbar border border-outline-variant/20 rounded-xl p-3 bg-background/50">
                        {Object.values(servers).filter((srv: any) => srv.type !== 'mqtt' && !srv.id?.toString().startsWith('mqtt-')).length === 0 ? (
                          <span className="text-xs italic text-on-surface-variant/50">Không có server SVMS khả dụng</span>
                        ) : (
                          Object.values(servers).filter((srv: any) => srv.type !== 'mqtt' && !srv.id?.toString().startsWith('mqtt-')).map((srv: any) => {
                            const isExpanded = expandedModalParents.has(srv.id);
                            const serverDevices = devices[srv.id]?.devices || [];
                            return (
                              <div key={srv.id} className="flex flex-col gap-1 border-b border-outline-variant/10 pb-1 last:border-0 last:pb-0">
                                <div 
                                  onClick={() => toggleModalParentExpand(srv.id)}
                                  className="flex items-center justify-between p-2 hover:bg-surface-container rounded-lg cursor-pointer transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    <Folder className="w-3.5 h-3.5 text-warning shrink-0" />
                                    <span className="text-xs font-bold text-white truncate">{srv.server_name || srv.id}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] px-1.5 py-0.5 bg-primary/20 text-primary rounded font-mono font-bold uppercase">{serverDevices.length} thiết bị</span>
                                    {isExpanded ? <ChevronDown className="w-3 h-3 text-on-surface-variant" /> : <ChevronRight className="w-3 h-3 text-on-surface-variant" />}
                                  </div>
                                </div>
                                
                                {isExpanded && (
                                  <div className="flex flex-col gap-1.5 pl-5 py-1 animate-in slide-in-from-top-1 duration-150">
                                    {serverDevices.length === 0 ? (
                                      <span className="text-[10px] italic text-on-surface-variant/50">Trống (Không có thiết bị)</span>
                                    ) : (
                                      serverDevices.map((dev: any) => {
                                        const cleanIp = typeof dev.ip === 'string' ? dev.ip.split(':')[0] : String(dev.ip || '');
                                        const key = `svms::${srv.id}::${cleanIp}::${dev.name}`;
                                        const isChecked = selectedModalItems.has(key);
                                        return (
                                          <label 
                                            key={key}
                                            className="flex items-center gap-2.5 p-2 bg-surface-container/30 hover:bg-surface-container/60 rounded-lg cursor-pointer transition-colors text-xs font-semibold text-on-surface group"
                                          >
                                            <input 
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={() => toggleModalItemSelection(key)}
                                              className="w-3.5 h-3.5 rounded border-outline-variant text-primary focus:ring-primary/30"
                                            />
                                            <div className="flex flex-col min-w-0 flex-1">
                                              <span className="text-white group-hover:text-primary transition-colors truncate">{dev.name}</span>
                                              <span className="text-[9px] text-on-surface-variant/70 font-mono mt-0.5 truncate">IP: {cleanIp}</span>
                                            </div>
                                          </label>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {addType === 'mqtt-sensor' && (
                    <div className="flex flex-col gap-2 border-t border-outline-variant/10 pt-3 mt-1">
                      <span className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Chọn cảm biến/radar MQTT ({selectedModalItems.size} đã chọn)</span>
                      <div className="flex flex-col gap-2 max-h-60 overflow-y-auto custom-scrollbar border border-outline-variant/20 rounded-xl p-3 bg-background/50">
                        {mqttGroups.length === 0 && Object.keys(mqttDevicesByServer).length === 0 ? (
                          <span className="text-xs italic text-on-surface-variant/50">Không có group MQTT khả dụng</span>
                        ) : (
                          (mqttGroups.length > 0 ? mqttGroups : Object.keys(mqttDevicesByServer).map((id: any) => ({ id, brokerHost: id }))).map((group: any) => {
                            const isExpanded = expandedModalParents.has(group.id);
                            const groupDevices = mqttDevicesByServer[group.id] || [];
                            return (
                              <div key={group.id} className="flex flex-col gap-1 border-b border-outline-variant/10 pb-1 last:border-0 last:pb-0">
                                <div 
                                  onClick={() => toggleModalParentExpand(group.id)}
                                  className="flex items-center justify-between p-2 hover:bg-surface-container rounded-lg cursor-pointer transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    <Folder className="w-3.5 h-3.5 text-warning shrink-0" />
                                    <span className="text-xs font-bold text-white truncate">{group.brokerHost || group.id}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] px-1.5 py-0.5 bg-tertiary/20 text-tertiary rounded font-mono font-bold uppercase">{groupDevices.length} cảm biến</span>
                                    {isExpanded ? <ChevronDown className="w-3 h-3 text-on-surface-variant" /> : <ChevronRight className="w-3 h-3 text-on-surface-variant" />}
                                  </div>
                                </div>
                                
                                {isExpanded && (
                                  <div className="flex flex-col gap-1.5 pl-5 py-1 animate-in slide-in-from-top-1 duration-150">
                                    {groupDevices.length === 0 ? (
                                      <span className="text-[10px] italic text-on-surface-variant/50">Trống (Không có thiết bị)</span>
                                    ) : (
                                      groupDevices.map((dev: any) => {
                                        const devName = dev.deviceName || dev.deviceProfileName || dev.devEui;
                                        const key = `mqtt::${group.id}::${dev.devEui}::${devName}`;
                                        const isChecked = selectedModalItems.has(key);
                                        return (
                                          <label 
                                            key={key}
                                            className="flex items-center gap-2.5 p-2 bg-surface-container/30 hover:bg-surface-container/60 rounded-lg cursor-pointer transition-colors text-xs font-semibold text-on-surface group"
                                          >
                                            <input 
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={() => toggleModalItemSelection(key)}
                                              className="w-3.5 h-3.5 rounded border-outline-variant text-primary focus:ring-primary/30"
                                            />
                                            <div className="flex flex-col min-w-0 flex-1">
                                              <span className="text-white group-hover:text-tertiary transition-colors truncate">{devName}</span>
                                              <span className="text-[9px] text-on-surface-variant/70 font-mono mt-0.5 truncate">EUI: {dev.devEui}</span>
                                            </div>
                                          </label>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {addType === 'sunell-camera' && (
                    <div className="flex flex-col gap-2 border-t border-outline-variant/10 pt-3 mt-1">
                      <span className="text-[10px] font-bold uppercase text-on-surface-variant/80 tracking-wider">Chọn Camera Sunell ({selectedModalItems.size} đã chọn)</span>
                      <div className="flex flex-col gap-1 max-h-60 overflow-y-auto custom-scrollbar border border-outline-variant/20 rounded-xl p-3 bg-background/50">
                        {cameraDevices.filter((c: any) => c.type === 'sunell').length === 0 ? (
                          <span className="text-xs italic text-on-surface-variant/50">Không có camera Sunell khả dụng</span>
                        ) : (
                          cameraDevices.filter((c: any) => c.type === 'sunell').map((cam: any) => {
                            const key = `sunell::${cam.id}::${cam.cameraIp}::${cam.name || cam.cameraIp}`;
                            const isChecked = selectedModalItems.has(key);
                            return (
                              <label 
                                key={key}
                                className="flex items-center gap-2.5 p-2 bg-surface-container/30 hover:bg-surface-container/60 rounded-lg cursor-pointer transition-colors text-xs font-semibold text-on-surface group border-b border-outline-variant/5 last:border-0"
                              >
                                <input 
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleModalItemSelection(key)}
                                  className="w-3.5 h-3.5 rounded border-outline-variant text-primary focus:ring-primary/30"
                                />
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="text-white group-hover:text-primary transition-colors truncate">{cam.name || cam.cameraIp}</span>
                                  <span className="text-[9px] text-on-surface-variant/70 font-mono mt-0.5 truncate">IP: {cam.cameraIp}</span>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Form Buttons */}
              <div className="flex items-center gap-3 border-t border-outline-variant/10 pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 bg-surface-container hover:bg-surface-container-high text-on-surface font-semibold text-xs uppercase tracking-wider rounded-xl transition-all border border-outline-variant/30"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-primary text-on-primary hover:bg-primary-hover font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow"
                >
                  Xác nhận thêm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

interface AreaLivePlayerProps {
  cameraId: string;
  cameraName: string;
  rtspUrl: string;
  cameraIp?: string;
}

export function AreaLivePlayer({ cameraId, cameraName, rtspUrl, cameraIp = '' }: AreaLivePlayerProps) {
  const [streamInfo, setStreamInfo] = useState<any>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [checkInterval, setCheckInterval] = useState(3000);
  const [fetchErrorCount, setFetchErrorCount] = useState(0);

  // Initialize and check stream status
  useEffect(() => {
    let active = true;

    const checkState = async () => {
      try {
        const { data } = await apiClient.get(`/api/v1/rtsp-streams/${cameraId}`);
        if (!active) return;
        if (data.success && data.stream) {
          setStreamInfo(data.stream);
          setFetchErrorCount(0);
          if (data.stream.status === 'running') {
            setCheckInterval(2000);
          } else {
            setCheckInterval(3000);
          }
        }
      } catch {
        if (!active) return;
        setFetchErrorCount(prev => prev + 1);
        if (fetchErrorCount > 3) {
          setStreamInfo({ status: 'error', lastError: 'Không thể kết nối với server stream' });
        }
      }
    };

    checkState();
    const timer = setInterval(checkState, checkInterval);

    // Automatically trigger connect if not running or connecting
    apiClient.post('/api/v1/rtsp-streams', {
      id: cameraId,
      rtspUrl: rtspUrl
    }).catch((err: any) => console.warn('Failed to auto-connect stream:', err));

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [cameraId, rtspUrl, checkInterval, fetchErrorCount]);

  // Fetch frame snapshots at 1 FPS when stream is running
  useEffect(() => {
    if (streamInfo?.status !== 'running') return;

    let active = true;
    let timer: any = null;

    const fetchFrame = async () => {
      try {
        const response = await apiClient.post(`/api/v1/rtsp-streams/${cameraId}/snapshot?format=image`, {}, {
          responseType: 'blob',
          headers: {
            'Accept': 'image/jpeg'
          }
        });
        
        if (!active) return;
        
        const blob = response.data;
        const objectUrl = URL.createObjectURL(blob);
        
        setFrameUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      } catch (err) {
        console.warn('Failed to fetch snapshot frame:', err);
      }
    };

    fetchFrame();
    timer = setInterval(fetchFrame, 1000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [streamInfo?.status, cameraId]);

  // Cleanup frame url on unmount
  useEffect(() => {
    return () => {
      if (frameUrl) {
        URL.revokeObjectURL(frameUrl);
      }
    };
  }, [frameUrl]);

  const handleReconnect = () => {
    setStreamInfo({ status: 'connecting' });
    apiClient.post('/api/v1/rtsp-streams', {
      id: cameraId,
      rtspUrl: rtspUrl
    }).catch((err: any) => console.error('Failed to trigger reconnect:', err));
  };

  const streamStatus = streamInfo?.status || 'connecting';
  const showStreamImage = streamStatus === 'running' && !!frameUrl;

  return (
    <div className="relative w-full aspect-video bg-zinc-950 rounded-2xl border border-outline-variant/15 overflow-hidden flex flex-col justify-center items-center shadow-inner group">
      {showStreamImage ? (
        <img
          src={frameUrl}
          alt={cameraName}
          className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-40'}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(false)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-zinc-950/80 text-on-surface-variant">
          {streamStatus === 'connecting' ? (
            <div className="flex flex-col items-center gap-2">
              <Activity className="w-6 h-6 text-primary animate-pulse" />
              <span className="text-[10px] uppercase font-bold tracking-widest text-primary animate-pulse">Đang kết nối luồng RTSP...</span>
              <span className="text-[9px] opacity-75 font-mono truncate max-w-xs">{cameraIp}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 max-w-[90%]">
              <AlertTriangle className="w-6 h-6 text-error" />
              <span className="text-[10px] uppercase font-bold tracking-widest text-error">Kết nối stream thất bại</span>
              <p className="text-[9px] opacity-70 line-clamp-2 mt-1 break-all bg-error/10 border border-error/20 px-2 py-1 rounded max-h-[50px] overflow-y-auto">
                {streamInfo?.lastError || 'Lỗi kết nối hoặc không tìm thấy luồng'}
              </p>
              <button
                onClick={handleReconnect}
                className="mt-2 text-[9px] font-bold uppercase tracking-widest bg-primary/20 hover:bg-primary text-white border border-primary/30 px-3 py-1.5 rounded flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin duration-1000" /> Thử lại
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating Header label */}
      <div className="absolute top-2 left-2 z-10">
        <span className="text-[9px] font-bold text-white tracking-widest bg-black/60 backdrop-blur-md px-2 py-0.5 rounded border border-outline-variant/10">
          RTSP LIVE STREAM
        </span>
      </div>
    </div>
  );
}
