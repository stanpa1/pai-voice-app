import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
  isAgentTalking?: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume, isAgentTalking }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let rotation = 0;

    const render = () => {
      if (!isActive) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.fillStyle = 'rgba(17, 24, 39, 0.2)'; // Fade effect trail
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      // Base radius plus volume bump
      const baseRadius = 60;
      const radius = baseRadius + (volume * 150);

      rotation += 0.02;

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(rotation);

      // Draw active circle
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = isAgentTalking ? '#60A5FA' : '#34D399'; // Blue for agent, Green for user
      ctx.lineWidth = 4 + (volume * 10);
      ctx.stroke();

      // Inner reactive shapes
      if (volume > 0.01) {
          const spokes = 8;
          for(let i=0; i<spokes; i++) {
              ctx.rotate(Math.PI * 2 / spokes);
              ctx.beginPath();
              ctx.moveTo(radius + 10, 0);
              ctx.lineTo(radius + 30 + (volume * 50), 0);
              ctx.strokeStyle = isAgentTalking ? 'rgba(96, 165, 250, 0.5)' : 'rgba(52, 211, 153, 0.5)';
              ctx.lineWidth = 2;
              ctx.stroke();
          }
      }

      ctx.restore();
      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [isActive, volume, isAgentTalking]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-gray-900 rounded-3xl overflow-hidden shadow-inner shadow-gray-800">
      {!isActive && (
         <div className="absolute text-gray-500 font-mono tracking-widest text-sm">SYSTEM STANDBY</div>
      )}
      <canvas 
        ref={canvasRef} 
        width={400} 
        height={400} 
        className="w-full h-full max-w-[400px] max-h-[400px]"
      />
    </div>
  );
};