import React, { useEffect, useState } from 'react';
import { apiKeyRotation, RateLimitStatus } from '../services/apiKeyRotation';

/**
 * RateLimitIndicator - Circular progress indicator for API rate limit status
 * 
 * Features:
 * - Circular SVG progress indicator
 * - Shows current API key and availability
 * - Animated color changes based on status
 * - Expandable details panel
 */

interface RateLimitIndicatorProps {
    className?: string;
    showDetails?: boolean;
}

export const RateLimitIndicator: React.FC<RateLimitIndicatorProps> = ({
    className = '',
    showDetails = false
}) => {
    const [status, setStatus] = useState<RateLimitStatus | null>(null);
    const [isExpanded, setIsExpanded] = useState(showDetails);

    useEffect(() => {
        // Subscribe to status updates
        const unsubscribe = apiKeyRotation.subscribe(setStatus);
        return unsubscribe;
    }, []);

    if (!status || status.totalKeys === 0) {
        return null; // Don't show if no keys configured
    }

    // Calculate progress (inverse of usage - more usage = less remaining)
    const remainingPercentage = 100 - status.usagePercentage;

    // SVG circle properties
    const size = 40;
    const strokeWidth = 4;
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const strokeDashoffset = circumference - (remainingPercentage / 100) * circumference;

    // Color based on status
    const getColor = () => {
        if (status.isRateLimited) return '#ef4444'; // red
        if (status.availableKeys < status.totalKeys) return '#f59e0b'; // amber
        if (status.usagePercentage > 70) return '#f59e0b'; // amber
        return '#22c55e'; // green
    };

    const color = getColor();

    // Format time until reset
    const formatTimeUntilReset = () => {
        if (!status.estimatedResetTime) return null;
        const seconds = Math.max(0, Math.ceil((status.estimatedResetTime - Date.now()) / 1000));
        if (seconds < 60) return `${seconds}秒`;
        return `${Math.ceil(seconds / 60)}分`;
    };

    const resetTime = formatTimeUntilReset();

    return (
        <div className={`relative ${className}`}>
            {/* Circular indicator button */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="relative flex items-center justify-center w-10 h-10 rounded-full bg-black/30 backdrop-blur-sm border border-white/10 hover:border-white/20 transition-all"
                title="API使用状況"
            >
                {/* Background circle */}
                <svg width={size} height={size} className="absolute -rotate-90">
                    {/* Track */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="transparent"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth={strokeWidth}
                    />
                    {/* Progress */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="transparent"
                        stroke={color}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-500"
                    />
                </svg>

                {/* Center text */}
                <span className="relative text-[10px] font-bold text-white">
                    {status.availableKeys}/{status.totalKeys}
                </span>

                {/* Pulsing indicator when rate limited */}
                {status.isRateLimited && (
                    <span className="absolute inset-0 rounded-full border-2 border-red-500 animate-ping opacity-50" />
                )}
            </button>

            {/* Expanded details panel */}
            {isExpanded && (
                <div className="absolute top-12 right-0 w-64 glass-premium rounded-xl p-4 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        API使用状況
                    </h4>

                    {/* Key list */}
                    <div className="space-y-2 mb-4">
                        {apiKeyRotation.getKeyList().map((key, index) => (
                            <div
                                key={key.id}
                                className={`flex items-center justify-between p-2 rounded-lg transition-all ${key.isActive
                                        ? 'bg-white/10 border border-white/20'
                                        : 'bg-black/20'
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${key.isRateLimited ? 'bg-red-500' : key.isActive ? 'bg-green-500' : 'bg-gray-500'
                                        }`} />
                                    <span className="text-xs text-white/80">Key {index + 1}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400">{key.usageCount}回</span>
                                    {key.isRateLimited && (
                                        <span className="text-[10px] text-red-400">制限中</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Usage bar */}
                    <div className="mb-3">
                        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                            <span>使用量</span>
                            <span>{Math.round(status.usagePercentage)}%</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                                className="h-full transition-all duration-500 rounded-full"
                                style={{
                                    width: `${status.usagePercentage}%`,
                                    backgroundColor: color
                                }}
                            />
                        </div>
                    </div>

                    {/* Reset time */}
                    {resetTime && (
                        <p className="text-[10px] text-amber-400 flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            リセットまで: {resetTime}
                        </p>
                    )}

                    {/* Actions */}
                    <div className="mt-3 pt-3 border-t border-white/10">
                        <button
                            onClick={() => {
                                apiKeyRotation.resetUsage();
                                setIsExpanded(false);
                            }}
                            className="w-full text-xs text-gray-400 hover:text-white py-2 transition-colors"
                        >
                            使用量をリセット
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RateLimitIndicator;
