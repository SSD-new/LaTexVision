
import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { 
  Upload, 
  RefreshCcw, 
  Maximize2,
  AlertCircle,
  Loader2,
  Bug,
  ChevronRight,
  ChevronLeft,
  Settings2,
  Download,
  Eraser,
  X,
  Move,
  FileText,
  Scissors,
  Columns as ColumnsIcon,
  ChevronDown,
  Clock,
  Activity,
  Server,
  Save,
  Wifi,
  WifiOff,
  Timer,
  PencilRuler,
  CheckCircle2,
  Undo2,
  Play,
  Terminal,
  Sparkles,
  Layout,
  FileCode2,
  GripVertical,
  Copy,
  Type
} from 'lucide-react';
import { convertImageToLatex, refactorLatex } from './services/geminiService';
import { segmentImage, ImageBlock, BoundingBox, SegmentationConfig, checkOpenCVReady } from './services/layoutService';
import { AppStatus } from './types';
import LatexRenderer from './components/LatexRenderer';

// --- CodeMirror Imports ---
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { EditorView } from '@codemirror/view';

// --- Interfaces ---

interface EraserMask extends BoundingBox {
  id: string;
}

interface PageCut {
  id: string;
  y: number;
  colIdx: number;
}

interface ColumnCut {
  id: string;
  x: number;
}

interface PageData {
  image: string; // dataUrl
  width: number; // Original width
  height: number; // Original height
  blocks: ImageBlock[];
  masks: EraserMask[];
  cuts: PageCut[];
  columns: ColumnCut[];
  excludedBlockIds: Set<string>;
  config: SegmentationConfig;
}

interface AppSettings {
  useLocalServer: boolean;
  localServerUrl: string;
  requestTimeout: number;
}

// --- Constants ---

const PAGE_MARKER_PREFIX = "% --- СТРАНИЦА";
// Regex that matches the marker flexibly (case insensitive, flexible spaces)
const PAGE_MARKER_REGEX_SOURCE = "%\\s*---\\s*СТРАНИЦА\\s*\\d+\\s*---";

const DEFAULT_CONFIG: SegmentationConfig = {
  minW: 10,
  minH: 10,
  padx: 4,
  pady: 4,
  kernelW: 80,
  kernelH: 60,
  yTolerance: 0.7
};

const DEFAULT_SETTINGS: AppSettings = {
  useLocalServer: false,
  localServerUrl: 'http://localhost:5000',
  requestTimeout: 300
};

const LATEX_PREAMBLE = [
  "\\documentclass[12pt,a4paper]{article}",
  "\\usepackage[utf8]{inputenc}",
  "\\usepackage[T2A]{fontenc}",
  "\\usepackage[russian]{babel}",
  "\\usepackage{amsmath}",
  "\\usepackage{amssymb}",
  "\\usepackage{geometry}",
  "\\usepackage{multicol}",
  "\\geometry{left=1.5cm,right=1.5cm,top=2cm,bottom=2cm}",
  ""
].join("\n");

// --- Helper Components ---

const DraggableMask: React.FC<{
  mask: EraserMask;
  naturalWidth: number;
  naturalHeight: number;
  readOnly?: boolean;
  onUpdate: (id: string, updates: Partial<EraserMask>) => void;
  onDelete: (id: string) => void;
}> = ({ mask, naturalWidth, naturalHeight, readOnly, onUpdate, onDelete }) => {
  const [localMask, setLocalMask] = useState(mask);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) setLocalMask(mask);
  }, [mask, isDragging]);

  const handleMouseDown = (e: React.MouseEvent, type: 'move' | 'resize') => {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragging(true);
    
    const startX = e.clientX;
    const startY = e.clientY;
    const initX = localMask.x;
    const initY = localMask.y;
    const initW = localMask.width;
    const initH = localMask.height;

    let pendingUpdate: Partial<EraserMask> | null = null;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const container = (e.target as Element).closest('.image-wrapper');
      if (!container) return;
      
      const rect = container.getBoundingClientRect();
      const scaleX = naturalWidth / rect.width;
      const scaleY = naturalHeight / rect.height;

      const dx = (moveEvent.clientX - startX) * scaleX;
      const dy = (moveEvent.clientY - startY) * scaleY;

      if (type === 'move') {
        const nx = Math.max(0, Math.min(naturalWidth - initW, initX + dx));
        const ny = Math.max(0, Math.min(naturalHeight - initH, initY + dy));
        setLocalMask(prev => ({ ...prev, x: nx, y: ny }));
        pendingUpdate = { x: nx, y: ny };
      } else {
        const nw = Math.max(20, Math.min(naturalWidth - initX, initW + dx));
        const nh = Math.max(20, Math.min(naturalHeight - initY, initH + dy));
        setLocalMask(prev => ({ ...prev, width: nw, height: nh }));
        pendingUpdate = { width: nw, height: nh };
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setIsDragging(false);
      
      if (pendingUpdate) {
        onUpdate(mask.id, pendingUpdate);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const displayW = naturalWidth || 1;
  const displayH = naturalHeight || 1;

  return (
    <div 
      style={{ 
        left: `${(localMask.x / displayW) * 100}%`, 
        top: `${(localMask.y / displayH) * 100}%`, 
        width: `${(localMask.width / displayW) * 100}%`, 
        height: `${(localMask.height / displayH) * 100}%` 
      }}
      className={`absolute border-2 border-red-500 bg-red-500/30 z-30 transition-opacity ${readOnly ? 'pointer-events-none opacity-40' : 'group pointer-events-auto shadow-sm opacity-100'}`}
    >
      {!readOnly && (
        <>
          <div onMouseDown={(e) => handleMouseDown(e, 'move')} className="absolute inset-0 cursor-move flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/5">
            <Move className="w-5 h-5 text-white drop-shadow-md" />
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(mask.id); }} 
            className="absolute -top-3 -right-3 w-7 h-7 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg pointer-events-auto hover:scale-110 transition-transform"
          >
            <X className="w-4 h-4" />
          </button>
          <div onMouseDown={(e) => handleMouseDown(e, 'resize')} className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize bg-red-600 rounded-tl-lg" />
        </>
      )}
    </div>
  );
};

const DraggableCut: React.FC<{
  cut: PageCut;
  naturalWidth: number;
  naturalHeight: number;
  columns: ColumnCut[];
  readOnly?: boolean;
  onUpdate: (id: string, y: number) => void;
  onDelete: (id: string) => void;
}> = ({ cut, naturalWidth, naturalHeight, columns, readOnly, onUpdate, onDelete }) => {
  const [localY, setLocalY] = useState(cut.y);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) setLocalY(cut.y);
  }, [cut.y, isDragging]);

  const sortedVCuts = [...columns.map(c => c.x)].sort((a,b) => a-b);
  const leftX = cut.colIdx === 0 ? 0 : sortedVCuts[cut.colIdx - 1];
  const rightX = cut.colIdx >= sortedVCuts.length ? naturalWidth : sortedVCuts[cut.colIdx];

  const handleMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragging(true);
    const startY = e.clientY;
    const initY = localY;
    
    let pendingY = initY;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const container = (e.target as Element).closest('.image-wrapper');
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const scaleY = naturalHeight / rect.height;
      const dy = (moveEvent.clientY - startY) * scaleY;
      
      pendingY = Math.max(0, Math.min(naturalHeight, initY + dy));
      setLocalY(pendingY);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setIsDragging(false);
      onUpdate(cut.id, pendingY);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const displayW = naturalWidth || 1;
  const displayH = naturalHeight || 1;

  return (
    <div 
      style={{ 
        top: `${(localY / displayH) * 100}%`,
        left: `${(leftX / displayW) * 100}%`,
        width: `${((rightX - leftX) / displayW) * 100}%`
      }}
      className={`absolute h-0.5 border-t-2 border-dashed border-indigo-500 z-40 transition-opacity ${readOnly ? 'pointer-events-none opacity-60' : 'pointer-events-auto group opacity-100'}`}
    >
      {!readOnly && (
        <>
          <div 
            onMouseDown={handleMouseDown}
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xl cursor-ns-resize opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Scissors className="w-4 h-4" />
          </div>
          <div className="absolute left-0 -top-4 text-[8px] font-black text-indigo-600 bg-white px-1 rounded shadow-sm opacity-0 group-hover:opacity-100 pointer-events-none">
            КОЛ {cut.colIdx + 1}
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(cut.id); }}
            className="absolute right-0 -translate-y-1/2 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity translate-x-1/2 hover:scale-110"
          >
            <X className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  );
};

const DraggableColumn: React.FC<{
  col: ColumnCut;
  naturalWidth: number;
  readOnly?: boolean;
  onUpdate: (id: string, x: number) => void;
  onDelete: (id: string) => void;
}> = ({ col, naturalWidth, readOnly, onUpdate, onDelete }) => {
  const [localX, setLocalX] = useState(col.x);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) setLocalX(col.x);
  }, [col.x, isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    setIsDragging(true);
    const startX = e.clientX;
    const initX = localX;
    
    let pendingX = initX;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const container = (e.target as Element).closest('.image-wrapper');
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const scaleX = naturalWidth / rect.width;
      const dx = (moveEvent.clientX - startX) * scaleX;
      
      pendingX = Math.max(0, Math.min(naturalWidth, initX + dx));
      setLocalX(pendingX);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setIsDragging(false);
      onUpdate(col.id, pendingX);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const displayW = naturalWidth || 1;

  return (
    <div 
      style={{ left: `${(localX / displayW) * 100}%` }}
      className={`absolute top-0 bottom-0 w-0.5 border-l-2 border-dashed border-blue-500 z-40 transition-opacity ${readOnly ? 'pointer-events-none opacity-60' : 'pointer-events-auto group opacity-100'}`}
    >
      {!readOnly && (
        <>
          <div 
            onMouseDown={handleMouseDown}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xl cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ColumnsIcon className="w-4 h-4" />
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(col.id); }}
            className="absolute top-4 -translate-x-1/2 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110"
          >
            <X className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  );
};

const ConfigSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  showMax?: boolean;
}> = ({ label, value, min, max, step = 1, onChange, showMax }) => {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(Number(e.target.value));
  };

  const handleCommit = () => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between">
         <label className="text-[10px] font-black text-slate-500 uppercase">
          {label}
        </label>
        <span className="text-[10px] font-bold text-indigo-600">{Number(localValue).toFixed(step < 1 ? 1 : 0)}</span>
      </div>
      <input 
        type="range" min={min} max={max} step={step} value={localValue}
        onChange={handleChange}
        onMouseUp={handleCommit}
        onTouchEnd={handleCommit}
        className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 block"
      />
    </div>
  );
};

const PaginationBar: React.FC<{
  current: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  className?: string;
}> = ({ current, total, onNext, onPrev, className }) => (
   <div className={`h-14 bg-white rounded-2xl border border-slate-200 shadow-xl flex items-center justify-center gap-6 z-50 ${className}`}>
      <button 
        disabled={current === 0}
        onClick={onPrev}
        className="p-2 hover:bg-slate-100 rounded-full disabled:opacity-30 transition-colors"
      >
        <ChevronLeft className="w-5 h-5 text-slate-800" />
      </button>
      <span className="text-sm font-black text-slate-900 tracking-wide">
        СТРАНИЦА {current + 1} из {total}
      </span>
      <button 
        disabled={current === total - 1}
        onClick={onNext}
        className="p-2 hover:bg-slate-100 rounded-full disabled:opacity-30 transition-colors"
      >
        <ChevronRight className="w-5 h-5 text-slate-800" />
      </button>
   </div>
);

// --- Settings Modal ---

const SettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
}> = ({ isOpen, onClose, settings, onSave }) => {
  const [localSettings, setLocalSettings] = useState(settings);

  useEffect(() => {
    if (isOpen) setLocalSettings(settings);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-black text-slate-800 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-indigo-600" />
            Настройки
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="space-y-4">
             <div className="flex items-start justify-between">
                <div>
                   <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                     {localSettings.useLocalServer ? <WifiOff className="w-4 h-4 text-orange-500" /> : <Wifi className="w-4 h-4 text-green-500" />}
                     Локальный сервер (Offline)
                   </h4>
                   <p className="text-xs text-slate-500 mt-1 max-w-[280px] leading-relaxed">
                     Используйте свой сервер в локальной сети, если пропал интернет.
                   </p>
                </div>
                <div 
                   onClick={() => setLocalSettings(s => ({...s, useLocalServer: !s.useLocalServer}))}
                   className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${localSettings.useLocalServer ? 'bg-indigo-600' : 'bg-slate-200'}`}
                >
                   <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${localSettings.useLocalServer ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
             </div>

             {localSettings.useLocalServer && (
               <div className="space-y-4 animate-in slide-in-from-top-2 pt-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-600 uppercase">Адрес сервера (LAN)</label>
                    <div className="relative">
                      <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        type="text" 
                        value={localSettings.localServerUrl}
                        onChange={(e) => setLocalSettings(s => ({...s, localServerUrl: e.target.value}))}
                        placeholder="http://192.168.1.XX:5000"
                        className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                       <label className="text-xs font-bold text-slate-600 uppercase flex items-center gap-2">
                         <Timer className="w-3.5 h-3.5" />
                         Таймаут запроса
                       </label>
                       <span className="text-xs font-bold text-indigo-600">{localSettings.requestTimeout} сек.</span>
                    </div>
                    <input 
                      type="range" 
                      min={60} 
                      max={1200} 
                      step={60}
                      value={localSettings.requestTimeout || 300}
                      onChange={(e) => setLocalSettings(s => ({...s, requestTimeout: Number(e.target.value)}))}
                      className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 block"
                    />
                    <p className="text-[10px] text-slate-400">
                      Увеличьте значение (до 20 мин), если сервер обрабатывает очень большие блоки.
                    </p>
                  </div>
               </div>
             )}
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
           <button 
             onClick={() => onSave(localSettings)}
             className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95"
           >
             <Save className="w-4 h-4" />
             Сохранить
           </button>
        </div>
      </div>
    </div>
  );
};


// --- Main App Component ---

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [cvReady, setCvReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  const [showDebug, setShowDebug] = useState(false);
  
  // GLOBAL EDITOR STATE - The "Mansion"
  // It contains ALL latex for ALL pages combined.
  const [editorContent, setEditorContent] = useState<string>('');
  
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, etaSeconds: 0 });
  const [showCutMenu, setShowCutMenu] = useState(false);

  // Edit Mode State
  const [isEditMode, setIsEditMode] = useState(false);
  const editSnapshotRef = useRef<{ masks: EraserMask[], cuts: PageCut[], columns: ColumnCut[] } | null>(null);

  // View Mode State: 'default' (Generator) or 'editor' (Full Editor)
  const [viewMode, setViewMode] = useState<'default' | 'editor'>('default');

  // SPLIT PANE RESIZING STATE (Overleaf Style)
  const [editorSplitPos, setEditorSplitPos] = useState(50); // percentage 
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  // Font Size State
  const [editorFontSize, setEditorFontSize] = useState(15);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  // Ref for CodeMirror View to handle scrolling
  const editorViewRef = useRef<EditorView | null>(null);
  
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const currentPage = pages[currentPageIndex] || null;

  // --- Autoscaling Logic for Paper ---
  const paperContentRef = useRef<HTMLDivElement>(null);
  const [paperScale, setPaperScale] = useState(1);

  useLayoutEffect(() => {
    if (paperContentRef.current) {
        // Measure natural height
        const contentHeight = paperContentRef.current.scrollHeight;
        const A4_HEIGHT_PX = 1123; // approx 297mm at 96dpi
        
        // If content overflows A4 height, try to scale it down to fit single page,
        // but cap the scaling at 0.85 to prevent text becoming too small.
        if (contentHeight > A4_HEIGHT_PX) {
            const fitScale = A4_HEIGHT_PX / contentHeight;
            setPaperScale(Math.max(0.85, fitScale));
        } else {
            setPaperScale(1);
        }
    }
  }, [editorContent, currentPageIndex, viewMode]);

  useEffect(() => {
    const check = () => {
      if (checkOpenCVReady()) {
        setCvReady(true);
      } else {
        setTimeout(check, 500);
      }
    };
    check();
    
    const saved = localStorage.getItem('latexVisionSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      } catch (e) { console.error("Failed to parse settings", e); }
    }
  }, []);

  // --- SPLIT DRAGGING LOGIC ---
  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSplit(true);
  };

  useEffect(() => {
    if (!isDraggingSplit) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (splitContainerRef.current) {
        const rect = splitContainerRef.current.getBoundingClientRect();
        const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
        // Clamp between 20% and 80% to preserve visibility
        const clamped = Math.max(20, Math.min(80, newWidth));
        setEditorSplitPos(clamped);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSplit(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplit]);


  // --- AUTO-SCROLL EDITOR ON FLIP OR GENERATION ---
  useEffect(() => {
    if (editorViewRef.current && status === AppStatus.LOADING) {
       // Scroll to bottom during generation
       const docLength = editorViewRef.current.state.doc.length;
       editorViewRef.current.dispatch({
         effects: EditorView.scrollIntoView(docLength)
       });
    }
  }, [status, editorContent]);

  // --- SYNC SCROLL ON PAGE FLIP (IF NOT LOADING) ---
  useEffect(() => {
    if (editorViewRef.current && editorContent && status !== AppStatus.LOADING) {
      const marker = `${PAGE_MARKER_PREFIX} ${currentPageIndex + 1}`;
      const index = editorContent.indexOf(marker);
      if (index !== -1) {
         // Scroll to specific marker
         // EditorView expects a position in the document
         editorViewRef.current.dispatch({
           effects: EditorView.scrollIntoView(index, { y: "start" })
         });
      }
    }
  }, [currentPageIndex, status]);

  // --- RESET PREVIEW SCROLL ON FLIP ---
  useEffect(() => {
    if (previewContainerRef.current) {
        previewContainerRef.current.scrollTop = 0;
    }
  }, [currentPageIndex]);

  // --- HELPERS FOR PAGE CONTENT EXTRACTION ---
  
  // Extracts only the content for the current page to feed the RENDERER
  const getCurrentPageRendererContent = () => {
    if (!editorContent) return "";
    
    // Split by markers using the flexible regex
    // We expect format: ... % --- СТРАНИЦА 1 --- ... % --- СТРАНИЦА 2 --- ...
    const parts = editorContent.split(new RegExp(PAGE_MARKER_REGEX_SOURCE, 'i'));
    
    // parts[0] is usually preamble or empty.
    // parts[1] corresponds to Page 1, parts[2] to Page 2, etc.
    const pageIndexShifted = currentPageIndex + 1;
    
    if (parts.length > pageIndexShifted) {
       return parts[pageIndexShifted];
    }
    
    // Fallback: if markers are broken/missing, show full content to avoid showing nothing
    if (parts.length > 1) {
        return "";
    }

    return editorContent;
  };

  const handleEditorChange = useCallback((value: string) => {
    setEditorContent(value);
  }, []);

  const handlePageChange = (direction: 'next' | 'prev') => {
    const newIndex = direction === 'next' ? currentPageIndex + 1 : currentPageIndex - 1;
    if (newIndex >= 0 && newIndex < pages.length) {
      setCurrentPageIndex(newIndex);
    }
  };

  const changePageInEditMode = (direction: 'next' | 'prev') => {
    const newIndex = direction === 'next' ? currentPageIndex + 1 : currentPageIndex - 1;
    if (newIndex < 0 || newIndex >= pages.length) return;

    // "Commit" changes for the current page by just moving on (snapshot is discarded)
    editSnapshotRef.current = null;

    // Switch index
    setCurrentPageIndex(newIndex);
    
    // Create snapshot for the new page immediately so 'Cancel' works for the new page
    // Note: We use the 'pages' from the current closure which has the data for the new page
    const newPage = pages[newIndex];
    editSnapshotRef.current = {
      masks: [...newPage.masks],
      cuts: [...newPage.cuts],
      columns: [...newPage.columns]
    };
  };

  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem('latexVisionSettings', JSON.stringify(newSettings));
    setShowSettings(false);
  };

  const detectLines = useCallback(async (
    pageIdx: number, 
    config: SegmentationConfig, 
    imageData: string, 
    masks: EraserMask[],
    hCuts: PageCut[],
    vCuts: ColumnCut[]
  ) => {
    if (!cvReady) return;
    
    setIsAnalyzing(true);
    await new Promise(resolve => setTimeout(resolve, 100));

    const tempImg = new Image();
    tempImg.src = imageData;
    await new Promise((resolve) => { tempImg.onload = resolve; });

    try {
      const { blocks: b } = await segmentImage(
        tempImg, 
        config, 
        masks, 
        hCuts.map(c => ({ y: c.y, colIdx: c.colIdx })),
        vCuts.map(c => c.x).sort((a,b) => a-b)
      );
      setPages(prev => {
        if (!prev[pageIdx]) return prev;
        const next = [...prev];
        next[pageIdx] = { ...next[pageIdx], blocks: b };
        return next;
      });
    } catch (err: any) {
      console.error("Ошибка сегментации страницы:", pageIdx, err);
      setError("Ошибка обработки изображения: " + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [cvReady]);

  // Main Detection Effect
  useEffect(() => {
    if (isEditMode) return;

    // Trigger detection if currentPage and cvReady are available.
    // We also include viewMode in dependency to force check/re-run when switching back to default.
    // But we safeguard logic to only run if we have data.
    if (currentPage && cvReady && viewMode === 'default') {
      const timer = setTimeout(() => {
        detectLines(
          currentPageIndex, 
          currentPage.config, 
          currentPage.image, 
          currentPage.masks, 
          currentPage.cuts, 
          currentPage.columns
        );
      }, 500); 
      return () => clearTimeout(timer);
    }
  }, [
    currentPageIndex, 
    currentPage?.config, 
    currentPage?.masks, 
    currentPage?.cuts, 
    currentPage?.columns, 
    currentPage?.image, 
    cvReady, 
    detectLines,
    isEditMode,
    viewMode // Added viewMode dependency
  ]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus(AppStatus.LOADING);
    setError(null);
    setProgress({ current: 0, total: 0, etaSeconds: 0 });

    setTimeout(async () => {
      const newPages: PageData[] = [];
      try {
        if (file.type === 'application/pdf') {
          const arrayBuffer = await file.arrayBuffer();
          // @ts-ignore
          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const unscaledViewport = page.getViewport({ scale: 1.0 });
            const MAX_DIMENSION = 1600;
            const maxSide = Math.max(unscaledViewport.width, unscaledViewport.height);
            const scale = Math.min(2.0, MAX_DIMENSION / maxSide);
            const viewport = page.getViewport({ scale: scale });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context!, viewport }).promise;

            const maxH = Math.max(100, Math.ceil(viewport.height * 0.2));
            const defaultKernelH = Math.floor(maxH / 2);

            newPages.push({
              image: canvas.toDataURL('image/png'),
              width: viewport.width,
              height: viewport.height,
              blocks: [],
              masks: [],
              cuts: [],
              columns: [],
              excludedBlockIds: new Set(),
              config: { ...DEFAULT_CONFIG, kernelH: defaultKernelH }
            });
          }
        } else {
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve) => {
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          
          const img = new Image();
          img.src = dataUrl;
          await new Promise((resolve) => { img.onload = resolve; });

          const maxH = Math.max(100, Math.ceil(img.naturalHeight * 0.2));
          const defaultKernelH = Math.floor(maxH / 2);

          newPages.push({
            image: dataUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
            blocks: [],
            masks: [],
            cuts: [],
            columns: [],
            excludedBlockIds: new Set(),
            config: { ...DEFAULT_CONFIG, kernelH: defaultKernelH }
          });
        }

        setPages(newPages);
        setCurrentPageIndex(0);
        setEditorContent(""); // Start fresh on new file
        setStatus(AppStatus.IDLE);
      } catch (err: any) {
        setError("Не удалось загрузить файл: " + err.message);
        setStatus(AppStatus.ERROR);
      }
    }, 50);
  };

  const updateCurrentConfig = (updates: Partial<SegmentationConfig>) => {
    setPages(prev => {
      const next = [...prev];
      if (next[currentPageIndex]) {
        next[currentPageIndex] = {
          ...next[currentPageIndex],
          config: { ...next[currentPageIndex].config, ...updates }
        };
      }
      return next;
    });
  };

  const toggleBlockExclusion = (blockId: string) => {
    if (isEditMode) return;
    setPages(prev => {
      const next = [...prev];
      const page = { ...next[currentPageIndex] };
      const newExclusions = new Set(page.excludedBlockIds);
      if (newExclusions.has(blockId)) newExclusions.delete(blockId);
      else newExclusions.add(blockId);
      page.excludedBlockIds = newExclusions;
      next[currentPageIndex] = page;
      return next;
    });
  };

  // --- Edit Mode Actions ---

  const enterEditMode = () => {
    if (!currentPage) return;
    editSnapshotRef.current = {
      masks: [...currentPage.masks],
      cuts: [...currentPage.cuts],
      columns: [...currentPage.columns]
    };
    setIsEditMode(true);
  };

  const saveEditMode = () => {
    setIsEditMode(false);
    editSnapshotRef.current = null;
  };

  const cancelEditMode = () => {
    const snapshot = editSnapshotRef.current;
    if (snapshot) {
      setPages(prev => {
        const next = [...prev];
        if (next[currentPageIndex]) {
          next[currentPageIndex] = {
            ...next[currentPageIndex],
            masks: snapshot.masks,
            cuts: snapshot.cuts,
            columns: snapshot.columns,
          };
        }
        return next;
      });
    }
    setIsEditMode(false);
    editSnapshotRef.current = null;
  };

  // --- Tool Actions ---

  const updateMask = (id: string, updates: Partial<EraserMask>) => {
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex] = {
        ...next[currentPageIndex],
        masks: next[currentPageIndex].masks.map(m => m.id === id ? { ...m, ...updates } : m)
      };
      return next;
    });
  };

  const deleteMask = (id: string) => {
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex].masks = next[currentPageIndex].masks.filter(m => m.id !== id);
      return next;
    });
  };

  const updateCut = (id: string, y: number) => {
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex] = {
        ...next[currentPageIndex],
        cuts: next[currentPageIndex].cuts.map(c => c.id === id ? { ...c, y } : c)
      };
      return next;
    });
  };

  const deleteCut = (id: string) => {
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex].cuts = next[currentPageIndex].cuts.filter(c => c.id !== id);
      return next;
    });
  };

  const updateColumn = (id: string, x: number) => {
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex] = {
        ...next[currentPageIndex],
        columns: next[currentPageIndex].columns.map(c => c.id === id ? { ...c, x } : c)
      };
      return next;
    });
  };

  const deleteColumn = (id: string) => {
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex].columns = next[currentPageIndex].columns.filter(c => c.id !== id);
      return next;
    });
  };

  const addMask = () => {
    if (!currentPage) return;
    const img = imageRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const newMask: EraserMask = {
      id: Math.random().toString(36).substr(2, 9),
      x: nw * 0.4, y: nh * 0.4,
      width: Math.min(nw * 0.2, 200),
      height: Math.min(nh * 0.1, 100)
    };
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex] = { ...next[currentPageIndex], masks: [...next[currentPageIndex].masks, newMask] };
      return next;
    });
  };

  const addCut = (colIdx: number) => {
    if (!currentPage) return;
    const img = imageRef.current;
    if (!img) return;
    const nh = img.naturalHeight;
    const newCut: PageCut = {
      id: Math.random().toString(36).substr(2, 9),
      y: nh * 0.5,
      colIdx
    };
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex] = { ...next[currentPageIndex], cuts: [...next[currentPageIndex].cuts, newCut] };
      return next;
    });
    setShowCutMenu(false);
  };

  const addColumn = () => {
    if (!currentPage) return;
    const img = imageRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const newCol: ColumnCut = {
      id: Math.random().toString(36).substr(2, 9),
      x: nw * 0.5
    };
    setPages(prev => {
      const next = [...prev];
      next[currentPageIndex] = { ...next[currentPageIndex], columns: [...next[currentPageIndex].columns, newCol] };
      return next;
    });
  };

  // --- Rendering Helpers ---

  const formatTime = (seconds: number) => {
    if (!seconds || seconds < 0) return "...";
    if (seconds < 60) return `${Math.ceil(seconds)}с`;
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return `${m}м ${s}с`;
  };

  const handleConvertAll = async () => {
    setStatus(AppStatus.LOADING);

    const pagesWithActualBlocks = pages.map(p => ({
      ...p,
      activeBlocks: p.blocks.filter(b => !p.excludedBlockIds.has(b.id))
    }));

    const totalBlocksToProcess = pagesWithActualBlocks.reduce((acc, p) => acc + p.activeBlocks.length, 0);

    if (totalBlocksToProcess === 0) {
      setError("Текст не обнаружен. Проверьте маски и настройки разметки.");
      setStatus(AppStatus.ERROR);
      return;
    }

    // --- STEP 1: INITIALIZE STREAMING VIEW ---
    // Clear old content immediately and set the structure.
    const initialContent = LATEX_PREAMBLE + "\n\n\\begin{document}\n\n\\end{document}";
    setEditorContent(initialContent);

    setProgress({ current: 0, total: totalBlocksToProcess, etaSeconds: 0 });

    let processedCount = 0;
    const startTime = Date.now();
    let lastEtaUpdate = 0;
    let currentEta = 0;

    const activeServerUrl = settings.useLocalServer ? settings.localServerUrl : undefined;
    const requestTimeoutMs = (settings.requestTimeout || 300) * 1000;

    // We build an array of content strings, one per page
    const pageResults = new Array(pagesWithActualBlocks.length).fill("");

    try {
      for (let pIdx = 0; pIdx < pagesWithActualBlocks.length; pIdx++) {
        const page = pagesWithActualBlocks[pIdx];
        
        let pageContent = "";
        const avgH = page.activeBlocks.length > 0 
          ? page.activeBlocks.reduce((acc, b) => acc + b.height, 0) / page.activeBlocks.length 
          : 25;
        const yThreshold = avgH * page.config.yTolerance;

        const numColumns = page.columns.length + 1;
        if (numColumns > 1) {
          pageContent += `\\begin{multicols}{${numColumns}}\n`;
        }

        const sortedVCuts = [...page.columns.map(c => c.x)].sort((a,b) => a-b);
        const getCol = (bx: number, bw: number) => {
          const mid = bx + bw/2;
          let c = 0;
          for(const cut of sortedVCuts) if(mid > cut) c++;
          return c;
        }

        for (let bIdx = 0; bIdx < page.activeBlocks.length; bIdx++) {
          const block = page.activeBlocks[bIdx];
          const base64Data = block.dataUrl.split(',')[1];

          let cleanPart = "";
          
          try {
             cleanPart = await convertImageToLatex(
               base64Data, 
               'image/jpeg', 
               3, 
               activeServerUrl,
               requestTimeoutMs
             );
          } catch (err: any) {
             console.error(`Block processing failed:`, err);
             if (err.message.includes("Превышено время")) {
                 throw err;
             }
             cleanPart = `\n% [Ошибка распознавания: ${err.message}]`;
          }

          if (cleanPart && cleanPart.trim() !== "") {
            if (bIdx > 0) {
              const prevBlock = page.activeBlocks[bIdx - 1];
              const currentCol = getCol(block.x, block.width);
              const prevCol = getCol(prevBlock.x, prevBlock.width);

              if (currentCol !== prevCol) {
                pageContent += "\n\n";
              } else {
                const isNewLine = Math.abs(block.y - prevBlock.y) > yThreshold;
                pageContent += isNewLine ? "\n\n" : " ";
              }
            }
            pageContent += cleanPart;
          }

          processedCount++;
          
          const now = Date.now();
          if (processedCount === 1 || now - lastEtaUpdate > 1000) {
             const elapsed = now - startTime;
             const avgTimePerBlock = elapsed / processedCount;
             const remainingBlocks = totalBlocksToProcess - processedCount;
             currentEta = (avgTimePerBlock * remainingBlocks) / 1000;
             lastEtaUpdate = now;
          }

          setProgress({ current: processedCount, total: totalBlocksToProcess, etaSeconds: currentEta });
          
          // --- STEP 2: STREAM TO EDITOR ---
          // Update the specific page content in our buffer
          pageResults[pIdx] = pageContent;
          
          // Rebuild the full document string dynamically
          let liveFullLatex = LATEX_PREAMBLE + "\n\n\\begin{document}\n";
          
          pageResults.forEach((content, idx) => {
              // Only add page marker if we have actually started processing this page or previous pages exist
              if (idx <= pIdx) {
                  liveFullLatex += `\n${PAGE_MARKER_PREFIX} ${idx + 1} ---\n`;
                  if (numColumns > 1 && idx === pIdx && !content.endsWith('\\end{multicols}')) {
                      // Temporarily close multicol for valid rendering during streaming if needed, 
                      // but here we just dump text.
                  }
                  liveFullLatex += content;
                  
                  if (idx < pageResults.length - 1 && idx < pIdx) {
                      liveFullLatex += "\n\\newpage";
                  }
              }
          });

          liveFullLatex += "\n\n\\end{document}";
          setEditorContent(liveFullLatex);

          const delay = activeServerUrl ? 100 : 800;
          await new Promise(r => setTimeout(r, delay)); 
        }

        if (numColumns > 1) {
          pageContent += `\n\\end{multicols}`;
          // Final update for the page to close tags properly
          pageResults[pIdx] = pageContent;
        }
      }
      
      // Final pass to ensure everything is clean
      let finalFullLatex = LATEX_PREAMBLE + "\n\n\\begin{document}\n";
      pageResults.forEach((content, idx) => {
         finalFullLatex += `\n${PAGE_MARKER_PREFIX} ${idx + 1} ---\n`;
         finalFullLatex += content;
         if (idx < pageResults.length - 1) {
             finalFullLatex += "\n\\newpage";
         }
      });
      finalFullLatex += "\n\n\\end{document}";
      setEditorContent(finalFullLatex);

      setStatus(AppStatus.SUCCESS);
    } catch (err: any) {
      setError("Ошибка: " + err.message);
      setStatus(AppStatus.ERROR);
    }
  };

  const handleRefactor = async () => {
    if (!editorContent || status === AppStatus.LOADING) return;

    setStatus(AppStatus.LOADING);
    const originalText = editorContent;
    
    // Clear content but keep structure for user feedback "processing..."
    setEditorContent(LATEX_PREAMBLE + "\n\n\\begin{document}\n\n% Выполняется ИИ-рефакторинг...\n\n\\end{document}");

    try {
       const activeServerUrl = settings.useLocalServer ? settings.localServerUrl : undefined;
       const requestTimeoutMs = (settings.requestTimeout || 300) * 1000;

       const cleanedText = await refactorLatex(originalText, activeServerUrl, requestTimeoutMs);

       // Rebuild document
       const fullDoc = LATEX_PREAMBLE + "\n\n\\begin{document}\n\n" + cleanedText + "\n\n\\end{document}";
       setEditorContent(fullDoc);
       setStatus(AppStatus.SUCCESS);
    } catch (e: any) {
       console.error(e);
       setError("Ошибка рефакторинга: " + e.message);
       setStatus(AppStatus.ERROR);
       setEditorContent(originalText); // Restore on error
    }
  };

  const renderBlockOverlay = (b: ImageBlock, idx: number) => {
    const isExcluded = currentPage?.excludedBlockIds.has(b.id);
    if (!imageRef.current) return null;
    const nw = imageRef.current.naturalWidth;
    const nh = imageRef.current.naturalHeight;
    const baseOpacity = isEditMode ? 'opacity-20' : ''; 

    return (
      <div 
        key={b.id}
        style={{
          left: `${(b.x / nw) * 100}%`,
          top: `${(b.y / nh) * 100}%`,
          width: `${(b.width / nw) * 100}%`,
          height: `${(b.height / nh) * 100}%`,
        }}
        className={`absolute border-2 transition-all ${baseOpacity} ${isExcluded ? 'border-slate-300 opacity-20 grayscale' : 'border-indigo-600/60 bg-indigo-600/5'}`}
      >
        {showDebug && !isExcluded && !isEditMode && (
          <div className="absolute top-0 left-0 -translate-y-full px-1.5 py-0.5 rounded-t text-[8px] font-black text-white bg-indigo-600">
            {idx + 1}
          </div>
        )}
        {!isEditMode && (
          <button 
            onClick={(e) => { e.stopPropagation(); toggleBlockExclusion(b.id); }}
            className={`absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center shadow-md transition-colors pointer-events-auto z-20 ${isExcluded ? 'bg-slate-400 text-white' : 'bg-red-500 text-white hover:bg-red-600'}`}
            title={isExcluded ? "Вернуть блок" : "Исключить блок"}
          >
            {isExcluded ? <RefreshCcw className="w-3 h-3" /> : <X className="w-3 h-3" />}
          </button>
        )}
      </div>
    );
  };

  const downloadTex = () => {
    if (!editorContent) return;
    const blob = new Blob([editorContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'document.tex';
    link.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setPages([]);
    setCurrentPageIndex(0);
    setEditorContent('');
    setStatus(AppStatus.IDLE);
    setError(null);
    setIsEditMode(false);
  };

  const handleCompile = () => {
      // Force update implied by state change
  };

  const columnCount = currentPage ? currentPage.columns.length + 1 : 0;
  
  const maxKernelW = currentPage ? Math.max(100, Math.ceil(currentPage.width * 0.2)) : 100;
  const maxKernelH = currentPage ? Math.max(100, Math.ceil(currentPage.height * 0.2)) : 100;

  // The content sent to the renderer is determined by the current page index
  const rendererContent = getCurrentPageRendererContent();

  // --- Overleaf-ish Theme for CodeMirror ---
  const overleafTheme = useMemo(() => EditorView.theme({
    "&": {
      fontSize: `${editorFontSize}px`,
      height: "100%",
      backgroundColor: "#ffffff",
    },
    ".cm-content": {
      fontFamily: "'Source Code Pro', 'Fira Code', monospace",
      color: "#2f3136",
      caretColor: "#000",
      paddingBottom: "100px" // Ensure space to scroll past end
    },
    // Force Scroll behavior
    ".cm-scroller": {
      overflow: "auto !important",
      fontFamily: "inherit"
    },
    // Gutters (Line Numbers)
    ".cm-gutters": {
      backgroundColor: "#f4f5f7", 
      color: "#8899a6",
      borderRight: "1px solid #e1e4e8",
      fontSize: "10px",
      paddingRight: "5px"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#e8eaed",
      color: "#2f3136"
    },
    // Active Line
    ".cm-activeLine": {
      backgroundColor: "rgba(0, 0, 0, 0.03)"
    },
    // Selection
    ".cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#b5d5ff !important"
    },
    // Search Match
    ".cm-searchMatch": {
      backgroundColor: "#ffff00"
    }
  }), [editorFontSize]);

  const renderCodeEditorPanel = (containerClasses: string, style?: React.CSSProperties) => (
      <div style={style} className={`flex flex-col bg-white overflow-hidden ${containerClasses}`}>
        {/* Overleaf-style Toolbar */}
        <div className="px-3 py-2 border-b border-slate-300 flex items-center justify-between shrink-0 bg-[#f4f5f7]">
          <div className="flex items-center gap-3">
            {status === AppStatus.LOADING ? (
              <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                  <span className="text-xs font-bold text-indigo-600 animate-pulse">Live Writing...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-2">
                    main.tex
                  </h2>
                  <div className="h-4 w-px bg-slate-300 mx-1" />
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-1.5 py-0.5">
                     <Type className="w-3 h-3 text-slate-400" />
                     <select 
                       value={editorFontSize}
                       onChange={(e) => setEditorFontSize(Number(e.target.value))}
                       className="text-[10px] font-bold text-slate-600 bg-transparent outline-none cursor-pointer appearance-none pr-3"
                       style={{ backgroundImage: 'none' }}
                     >
                        {[12, 13, 14, 15, 16, 18, 20, 24].map(s => <option key={s} value={s}>{s}px</option>)}
                     </select>
                     <ChevronDown className="w-2.5 h-2.5 text-slate-400 -ml-3 pointer-events-none" />
                  </div>
              </div>
            )}
          </div>
            <div className="flex gap-2">
              <button 
              onClick={handleCompile}
              title="Обновить предпросмотр"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-xs transition-colors shadow-sm"
            >
              <Play className="w-3 h-3 fill-current" />
              Recompile
            </button>
            {editorContent && (
              <>
                <button onClick={downloadTex} title="Скачать .tex" className="p-1.5 hover:bg-slate-200 rounded text-slate-600 transition-colors">
                  <Download className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => { navigator.clipboard.writeText(editorContent); setCopied(true); setTimeout(()=>setCopied(false), 2000); }}
                  className={`p-1.5 rounded transition-colors text-slate-600 ${copied ? 'bg-green-100 text-green-700' : 'hover:bg-slate-200'}`}
                  title="Copy Code"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </>
            )}
            </div>
        </div>

        <div className="flex-1 overflow-hidden p-0 relative group">
            {error && (
              <div className="absolute top-4 left-4 right-4 z-10 p-3 bg-red-50 border border-red-100 rounded-xl flex gap-3 text-red-700 text-xs font-medium shadow-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            <div className="h-full w-full">
                <CodeMirror
                value={editorContent}
                height="100%"
                className="h-full"
                extensions={[
                    StreamLanguage.define(stex), // Basic LaTeX Highlighting
                    EditorView.lineWrapping,     // Text Wrap
                    overleafTheme                // Custom Theme
                ]}
                onChange={handleEditorChange}
                onCreateEditor={(view) => {
                    editorViewRef.current = view;
                }}
                basicSetup={{
                    lineNumbers: true,
                    highlightActiveLineGutter: true,
                    highlightActiveLine: true,
                    foldGutter: true,
                    dropCursor: true,
                    allowMultipleSelections: true,
                    indentOnInput: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    rectangularSelection: true,
                    crosshairCursor: true,
                    highlightSelectionMatches: true,
                }}
                />
            </div>
        </div>
      </div>
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans selection:bg-indigo-100 overflow-hidden">
      
      {/* HEADER */}
      <header className="flex-none h-12 bg-white border-b border-slate-200 px-4 flex items-center justify-between z-10 shadow-sm">
         <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1">
              <h1 className="text-lg font-black text-slate-900 tracking-tight">
                LaTexVision
              </h1>
              <span className="text-xs font-bold text-slate-400">by</span>
              <a
                href="https://github.com/SSD-new"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:underline transition-colors"
              >
                SD
              </a>
            </div>
            {settings.useLocalServer && (
               <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100">
                  <WifiOff className="w-3 h-3 text-indigo-600" />
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">Offline Mode</span>
               </div>
            )}
         </div>
         
         <div className="flex items-center gap-4">
             {/* View Mode Toggle */}
             {pages.length > 0 && (
               <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                 <button 
                   onClick={() => setViewMode('default')}
                   className={`px-3 py-1 flex items-center gap-2 rounded-md text-xs font-bold transition-all ${viewMode === 'default' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   <Layout className="w-3.5 h-3.5" />
                   Генерация
                 </button>
                 <button 
                   onClick={() => setViewMode('editor')}
                   className={`px-3 py-1 flex items-center gap-2 rounded-md text-xs font-bold transition-all ${viewMode === 'editor' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   <FileCode2 className="w-3.5 h-3.5" />
                   Редактор
                 </button>
               </div>
             )}

            <button 
              onClick={() => setShowSettings(true)}
              disabled={isEditMode}
              className={`p-1.5 rounded-lg transition-colors ${isEditMode ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-100 text-slate-500 hover:text-indigo-600'}`}
            >
               <Settings2 className="w-5 h-5" />
            </button>
         
            {!cvReady && (
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                OpenCV...
              </div>
            )}
            {status === AppStatus.LOADING && (
               <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 animate-pulse">
                <Activity className="w-4 h-4" />
                Обработка {progress.total > 0 && `(${Math.round(progress.current / progress.total * 100)}%)`}
              </div>
            )}
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-xs font-bold text-orange-500 animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                Сегментация...
              </div>
            )}
         </div>
      </header>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
        settings={settings}
        onSave={saveSettings}
      />

      {/* MAIN CONTENT */}
      <div 
        ref={splitContainerRef} 
        className={`flex-1 flex overflow-hidden ${isDraggingSplit ? 'cursor-col-resize select-none' : ''}`}
      >
        
        {pages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div 
              onClick={() => cvReady && fileInputRef.current?.click()}
              className={`w-full max-w-2xl h-[400px] border-4 border-dashed rounded-[40px] flex flex-col items-center justify-center cursor-pointer transition-all ${!cvReady ? 'opacity-50 cursor-not-allowed border-slate-200' : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/50 hover:shadow-lg bg-white'}`}
            >
              {status === AppStatus.LOADING ? (
                 <div className="flex flex-col items-center">
                   <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
                   <p className="mt-4 font-bold text-slate-500">Загрузка документа...</p>
                 </div>
              ) : (
                <>
                  <div className="p-6 bg-slate-100 rounded-3xl mb-4">
                    <Upload className="w-10 h-10 text-indigo-600" />
                  </div>
                  <h3 className="text-xl font-black text-slate-800">Загрузить PDF или Фото</h3>
                  <p className="mt-2 text-sm text-slate-500 font-medium">Поддержка многостраничных документов</p>
                </>
              )}
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,application/pdf" />
            </div>
          </div>
        ) : (
          <>
            {/* LEFT SIDEBAR (TOOLS) - Only shown in default mode */}
            {viewMode === 'default' && (
              <div className="w-64 flex-none bg-white border-r border-slate-200 flex flex-col overflow-y-auto z-20">
                <div className="p-4 space-y-3">
                  
                  {!isEditMode ? (
                    /* --- VIEW MODE SIDEBAR --- */
                    <>
                      <button 
                        onClick={handleConvertAll}
                        disabled={status === AppStatus.LOADING || isAnalyzing}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-bold text-sm shadow-md disabled:opacity-50"
                      >
                        <Maximize2 className="w-4 h-4" />
                        <span>Конвертировать</span>
                      </button>

                      <button 
                        onClick={handleRefactor}
                        disabled={status === AppStatus.LOADING || isAnalyzing}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-all font-bold text-sm shadow-md disabled:opacity-50 mt-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>ИИ проверка кода</span>
                      </button>

                      <div className="h-px bg-slate-100 my-2" />
                      
                      <button 
                        onClick={enterEditMode}
                        disabled={status === AppStatus.LOADING}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-white border-2 border-slate-200 text-slate-700 rounded-xl hover:border-indigo-300 hover:text-indigo-600 transition-all font-bold text-sm"
                      >
                        <PencilRuler className="w-4 h-4" />
                        <span>Редактировать разметку</span>
                      </button>

                      <button 
                        onClick={() => setShowDebug(!showDebug)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all font-bold text-sm text-left ${showDebug ? 'bg-indigo-100 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}`}
                      >
                        <Bug className="w-4 h-4" />
                        <span>Настройки сетки</span>
                      </button>

                      {showDebug && currentPage && (
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-4 mt-2">
                            <ConfigSlider 
                              label="Гориз. блок" 
                              value={currentPage.config.kernelW} 
                              min={1} 
                              max={maxKernelW} 
                              onChange={(val) => updateCurrentConfig({ kernelW: val })}
                            />
                            <ConfigSlider 
                              label="Верт. блок" 
                              value={currentPage.config.kernelH} 
                              min={1} 
                              max={maxKernelH} 
                              onChange={(val) => updateCurrentConfig({ kernelH: val })}
                            />
                            <ConfigSlider 
                              label="Отступ" 
                              value={currentPage.config.padx} 
                              min={0} 
                              max={20} 
                              onChange={(val) => updateCurrentConfig({ padx: val, pady: val })}
                            />
                            <ConfigSlider 
                              label="Толерантность" 
                              value={currentPage.config.yTolerance} 
                              min={0.1} 
                              max={1.5} 
                              step={0.1}
                              onChange={(val) => updateCurrentConfig({ yTolerance: val })}
                            />
                        </div>
                      )}
                    </>
                  ) : (
                    /* --- EDIT MODE SIDEBAR --- */
                    <>
                      <div className="p-2 mb-2 bg-indigo-50 border border-indigo-100 rounded-lg text-xs font-medium text-indigo-800 leading-tight">
                          Режим редактирования. Изменения применятся после нажатия "Готово".
                      </div>

                      <button 
                          onClick={saveEditMode}
                          className="w-full flex items-center gap-2 justify-center px-4 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all font-bold text-sm shadow-md"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Готово</span>
                        </button>

                        <button 
                          onClick={cancelEditMode}
                          className="w-full flex items-center gap-2 justify-center px-4 py-2 bg-slate-200 text-slate-700 rounded-xl hover:bg-slate-300 transition-all font-bold text-xs"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          <span>Отмена</span>
                        </button>

                        <div className="h-px bg-slate-200 my-2" />
                        <p className="px-1 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Инструменты</p>

                        <button 
                          onClick={addMask}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-700 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all font-bold text-sm text-left"
                        >
                          <Eraser className="w-4 h-4" />
                          <span>Стереть область</span>
                        </button>

                        <div className="relative group/cut">
                          <button 
                            onClick={() => setShowCutMenu(!showCutMenu)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all font-bold text-sm text-left justify-between ${showCutMenu ? 'bg-indigo-50 text-indigo-600' : ''}`}
                          >
                            <div className="flex items-center gap-3">
                              <Scissors className="w-4 h-4" />
                              <span>Разбить абзац</span>
                            </div>
                            <ChevronDown className="w-3 h-3 opacity-50" />
                          </button>
                          {showCutMenu && (
                            <div className="ml-4 mt-1 border-l-2 border-slate-100 pl-2 space-y-1">
                              {Array.from({ length: columnCount }).map((_, i) => (
                                <button
                                  key={i}
                                  onClick={() => { addCut(i); setShowCutMenu(false); }}
                                  className="w-full text-left px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors flex justify-between"
                                >
                                  Колонка {i + 1}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <button 
                          onClick={addColumn}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-700 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all font-bold text-sm text-left"
                        >
                          <ColumnsIcon className="w-4 h-4" />
                          <span>Добавить колонку</span>
                        </button>
                    </>
                  )}
                  
                  <div className="flex-1"></div>
                  
                  {!isEditMode && (
                    <button 
                      onClick={reset} 
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-400 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all font-bold text-xs text-left mt-4"
                    >
                      <RefreshCcw className="w-3.5 h-3.5" />
                      <span>Сбросить все</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* CENTER WORKSPACE */}
            <div className="flex-1 flex overflow-hidden relative">
               {/* LEFT SIDE OF CENTER SPLIT (Image in default, Code in Editor mode) */}
               {viewMode === 'default' ? (
                 <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden relative border-r border-slate-200 bg-slate-100 min-w-0">
                   <div className="relative shadow-2xl rounded-sm bg-white image-wrapper max-h-[calc(100%-10rem)] max-w-full flex" style={{ aspectRatio: currentPage ? `${currentPage.width} / ${currentPage.height}` : 'auto' }}>
                      <img 
                        ref={imageRef} 
                        src={currentPage?.image} 
                        alt="Page" 
                        className={`block max-h-full max-w-full object-contain pointer-events-none select-none transition-opacity ${isEditMode ? 'opacity-80' : ''}`}
                      />

                      {/* OVERLAYS LAYER */}
                      <div className="absolute inset-0">
                        {currentPage?.blocks.map((b, idx) => renderBlockOverlay(b, idx))}
                        
                        {currentPage?.masks.map(mask => (
                          <DraggableMask 
                            key={mask.id} 
                            mask={mask} 
                            naturalWidth={imageRef.current?.naturalWidth || 1000} 
                            naturalHeight={imageRef.current?.naturalHeight || 1000} 
                            readOnly={!isEditMode}
                            onUpdate={updateMask}
                            onDelete={deleteMask}
                          />
                        ))}
                        
                        {currentPage?.cuts.map(cut => (
                          <DraggableCut
                            key={cut.id}
                            cut={cut}
                            columns={currentPage.columns}
                            naturalWidth={imageRef.current?.naturalWidth || 1000} 
                            naturalHeight={imageRef.current?.naturalHeight || 1000} 
                            readOnly={!isEditMode}
                            onUpdate={updateCut}
                            onDelete={deleteCut}
                          />
                        ))}

                        {currentPage?.columns.map(col => (
                          <DraggableColumn
                            key={col.id}
                            col={col}
                            naturalWidth={imageRef.current?.naturalWidth || 1000} 
                            readOnly={!isEditMode}
                            onUpdate={updateColumn}
                            onDelete={deleteColumn}
                          />
                        ))}
                      </div>

                      {/* RE-CALCULATION / ANALYSIS LOADING OVERLAY */}
                      {isAnalyzing && (
                        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-indigo-900/5 transition-opacity duration-200">
                          <div className="bg-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-in fade-in zoom-in-95 duration-200 border border-slate-100">
                            <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
                            <span className="text-sm font-bold text-slate-700">Обновление разметки...</span>
                          </div>
                        </div>
                      )}

                      {/* LOADING OVERLAY (RECOGNITION) */}
                      {status === AppStatus.LOADING && (
                        <div className="absolute inset-0 z-[60] bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 transition-all duration-300">
                          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                          <h3 className="text-xl font-black text-slate-800 mb-2">Распознавание...</h3>
                          
                          <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
                            <div 
                              className="h-full bg-indigo-600 transition-all duration-500" 
                              style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }}
                            />
                          </div>
                          
                          <p className="text-sm font-bold text-slate-500">
                            Блок {progress.current} из {progress.total}
                          </p>
                          
                          <div className="flex items-center gap-2 mt-2 text-xs font-medium text-slate-400">
                            <Clock className="w-3 h-3" />
                            <span>Осталось примерно: {formatTime(progress.etaSeconds)}</span>
                          </div>
                        </div>
                      )}

                      {/* Pagination bar inside the wrapper but positioned below */}
                      {pages.length > 1 && (
                        <div className="absolute -bottom-20 left-0 right-0 flex items-center justify-center z-50">
                            <PaginationBar 
                              current={currentPageIndex} 
                              total={pages.length} 
                              onPrev={() => isEditMode ? changePageInEditMode('prev') : handlePageChange('prev')}
                              onNext={() => isEditMode ? changePageInEditMode('next') : handlePageChange('next')}
                            />
                        </div>
                      )}
                   </div>
                 </div>
               ) : (
                 // EDITOR MODE: Left Panel is Code
                 renderCodeEditorPanel("border-r border-slate-200", { width: `${editorSplitPos}%` })
               )}

               {/* RESIZER HANDLE (Only in Editor Mode) */}
               {viewMode === 'editor' && (
                 <div
                    className={`w-1 hover:bg-indigo-600 cursor-col-resize transition-colors z-40 flex-none bg-slate-200 relative group -ml-0.5 ${isDraggingSplit ? 'bg-indigo-600 w-1' : ''}`}
                    onMouseDown={handleSplitMouseDown}
                 >
                    {/* Invisible Hit Area */}
                    <div className="absolute inset-y-0 -left-1 -right-1 z-50 cursor-col-resize" />
                 </div>
               )}

               {/* RIGHT SIDE OF CENTER SPLIT (Always Preview) */}
               <div 
                  ref={previewContainerRef} 
                  style={viewMode === 'editor' ? { width: `${100 - editorSplitPos}%` } : undefined}
                  className={`${viewMode === 'editor' ? '' : 'flex-1'} bg-slate-200/50 overflow-y-auto relative flex flex-col items-center p-8 min-w-0 border-l border-slate-200`}
                >
                    {/* Paper Container */}
                    <div className="w-full max-w-[210mm] min-h-[297mm] bg-white shadow-xl border border-slate-300/60 px-[15mm] py-[10mm] pb-[20mm] transition-all origin-top overflow-hidden relative flex flex-col">
                         {rendererContent ? (
                            <div 
                                ref={paperContentRef} 
                                style={{ 
                                    transform: `scale(${paperScale})`, 
                                    transformOrigin: 'top center',
                                    width: '100%'
                                }}
                            >
                                <LatexRenderer content={rendererContent} />
                            </div>
                         ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 mt-32 opacity-60">
                                <FileText className="w-16 h-16" />
                                <p className="font-bold text-sm">Здесь появится отрендеренный документ</p>
                            </div>
                         )}
                         {rendererContent && (
                           <div className="absolute top-2 right-2 px-2 py-1 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold uppercase tracking-wider opacity-60 pointer-events-none">
                              Страница {currentPageIndex + 1}
                           </div>
                         )}
                    </div>
                    {/* Editor Mode Pagination */}
                    {viewMode === 'editor' && pages.length > 1 && (
                        <div className="sticky bottom-6 mt-12 z-50">
                            <PaginationBar 
                              current={currentPageIndex} 
                              total={pages.length} 
                              onPrev={() => handlePageChange('prev')}
                              onNext={() => handlePageChange('next')}
                              className="shadow-2xl border-slate-300/80"
                            />
                        </div>
                    )}
               </div>
            </div>

            {/* RIGHT SIDEBAR (CODE OUTPUT) - Only shown in default mode */}
            {viewMode === 'default' && (
               <div className="w-[400px] flex-none bg-white border-l border-slate-200 z-20">
                  {renderCodeEditorPanel("h-full")}
               </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
