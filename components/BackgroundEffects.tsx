import React from 'react';

/**
 * BackgroundEffects - Premium animated background component
 * Inspired by Orbital and LENZ design aesthetics
 * 
 * Features:
 * - Animated gradient mesh
 * - Floating orb particles
 * - Subtle grid overlay
 * - Noise texture
 * - Floating dot particles
 */
export const BackgroundEffects: React.FC<{ className?: string }> = ({ className = '' }) => {
    return (
        <div className={`bg-premium fixed inset-0 -z-10 ${className}`}>
            {/* Gradient mesh overlay */}
            <div className="bg-gradient-mesh" />

            {/* Floating orb particles */}
            <div className="particle-container">
                <div className="particle-orb particle-orb-1" />
                <div className="particle-orb particle-orb-2" />
                <div className="particle-orb particle-orb-3" />
            </div>

            {/* Grid lines overlay */}
            <div className="bg-grid-premium" />

            {/* Noise texture */}
            <div className="bg-noise" />

            {/* Floating small dots */}
            <div className="floating-dots">
                <div className="floating-dot" />
                <div className="floating-dot" />
                <div className="floating-dot" />
                <div className="floating-dot" />
                <div className="floating-dot" />
            </div>

            {/* Scanlines effect */}
            <div className="scanlines" />
        </div>
    );
};

/**
 * VideoContainer - Responsive 9:16 video container with decorations
 * Shows smartphone-style content on all devices,
 * with additional decorations visible on PC
 */
export const VideoContainer: React.FC<{
    children: React.ReactNode;
    showGlow?: boolean;
    className?: string;
}> = ({ children, showGlow = true, className = '' }) => {
    return (
        <div className={`relative flex items-center justify-center w-full h-full ${className}`}>
            {/* PC side decorations (only visible on md+) */}
            <div className="hidden md:block pc-side-decoration left" />
            <div className="hidden md:block pc-side-decoration right" />

            {/* Main video container */}
            <div className="video-container-9-16 relative">
                {/* Glowing border effect */}
                {showGlow && <div className="video-glow-border" />}

                {/* Content area */}
                <div className="relative w-full h-full">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default BackgroundEffects;
