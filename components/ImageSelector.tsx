import React, { useState, useEffect, useRef, useId } from 'react';
import { storageService } from '../services/storageService';
import { StoredImage } from '../types';

interface ImageSelectorProps {
  label: string;
  currentImage: string;
  onSelect: (dataUrl: string) => void;
  defaultImage: string;
}

export const ImageSelector: React.FC<ImageSelectorProps> = ({ label, currentImage, onSelect, defaultImage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<StoredImage[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Use unique ID for the input to ensure multiple instances work correctly
  const uniqueId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setHistory(storageService.getImages());
    }
  }, [isOpen]);

  // Utility to compress image before saving
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 300; // Resize to max 300px for avatar usage to save space
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
             reject(new Error("Canvas context failed"));
             return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          
          // Compress to JPEG 0.7 quality
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl);
        };
        img.onerror = (err) => reject(new Error("Image load failed"));
      };
      reader.onerror = (err) => reject(new Error("File read failed"));
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      // Compress first
      const compressedDataUrl = await compressImage(file);
      
      // Try to save to storage
      try {
        storageService.saveImage(compressedDataUrl);
        onSelect(compressedDataUrl);
        setIsOpen(false);
      } catch (err: any) {
        console.error(err);
        if (err.name === 'QuotaExceededError' || err.message?.includes('quota')) {
           alert("保存容量が一杯です。履歴から古い画像を削除してください。");
        } else {
           // If save fails but compression worked, still use it temporarily without saving to history
           onSelect(compressedDataUrl);
           setIsOpen(false);
        }
      }
    } catch (err) {
      console.error("Image processing error", err);
      alert("画像の処理に失敗しました。別の画像を試してください。");
    } finally {
      setIsProcessing(false);
      // Reset value so same file can be selected again
      if (e.target) e.target.value = '';
    }
  };

  const handleSelectFromHistory = (img: StoredImage) => {
    onSelect(img.dataUrl);
    setIsOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('この画像を履歴から削除しますか？')) {
      storageService.deleteImage(id);
      setHistory(prev => prev.filter(img => img.id !== id));
    }
  };

  return (
    <>
      <div className="flex items-center gap-4 p-2 rounded-lg hover:bg-gray-50 transition-colors">
        <div 
          onClick={() => setIsOpen(true)}
          className="w-20 h-20 shrink-0 border border-gray-300 hover:border-black cursor-pointer overflow-hidden relative group bg-gray-100 rounded-lg shadow-sm"
        >
          {currentImage ? (
            <img src={currentImage} alt={label} className="w-full h-full object-cover" />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 font-mono text-[10px] uppercase">No Img</div>
          )}
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-white text-[10px] font-bold uppercase">Edit</span>
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
           <label className="text-xs font-bold uppercase tracking-widest block mb-1 text-gray-500">{label}</label>
           <button 
             onClick={() => setIsOpen(true)}
             className="text-sm font-bold underline decoration-2 underline-offset-4 truncate max-w-full text-left"
           >
             Change Avatar
           </button>
        </div>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setIsOpen(false)}>
          <div className="bg-white border border-black w-full max-w-lg p-6 animate-in fade-in zoom-in duration-200 shadow-2xl relative flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h3 className="font-display font-bold text-xl uppercase">画像を選択</h3>
              <button onClick={() => setIsOpen(false)} className="text-xs font-mono underline hover:text-gray-500">CLOSE</button>
            </div>

            <div className="flex border-b border-gray-200 mb-6 shrink-0">
              <button 
                onClick={() => setActiveTab('upload')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${activeTab === 'upload' ? 'border-b-2 border-black bg-gray-50' : 'text-gray-400 hover:text-black'}`}
              >
                アップロード
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${activeTab === 'history' ? 'border-b-2 border-black bg-gray-50' : 'text-gray-400 hover:text-black'}`}
              >
                履歴から選択
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
            {activeTab === 'upload' && (
              <div className="py-8 text-center flex flex-col items-center">
                <input 
                  id={`file-input-${uniqueId}`}
                  type="file" 
                  accept="image/*" 
                  onChange={handleFileUpload} 
                  ref={fileInputRef}
                  className="hidden" 
                />
                
                <label
                  htmlFor={`file-input-${uniqueId}`}
                  className={`w-40 h-40 border-2 border-dashed border-black rounded-lg flex flex-col items-center justify-center hover:bg-gray-50 transition-colors mb-6 group cursor-pointer ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {isProcessing ? (
                     <div className="w-8 h-8 border-2 border-black border-t-transparent animate-spin rounded-full"></div>
                  ) : (
                    <>
                      <span className="text-4xl mb-2 group-hover:-translate-y-1 transition-transform">📂</span>
                      <span className="font-bold text-xs uppercase">ファイルを選択</span>
                    </>
                  )}
                </label>
                
                <button 
                  onClick={() => { onSelect(defaultImage); setIsOpen(false); }} 
                  className="text-xs font-mono underline text-gray-400 hover:text-black"
                >
                  デフォルトに戻す
                </button>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="grid grid-cols-3 gap-3">
                {history.length === 0 && (
                   <div className="col-span-3 text-center py-8 text-gray-400 font-mono text-xs">履歴がありません</div>
                )}
                {history.map(img => (
                  <div key={img.id} onClick={() => handleSelectFromHistory(img)} className="aspect-square border border-gray-200 relative group cursor-pointer hover:border-black rounded-md overflow-hidden">
                    <img src={img.dataUrl} className="w-full h-full object-cover" />
                    <button 
                      onClick={(e) => handleDelete(e, img.id)}
                      className="absolute top-0 right-0 bg-red-600 text-white w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 text-[10px] hover:bg-red-700 transition-all"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};