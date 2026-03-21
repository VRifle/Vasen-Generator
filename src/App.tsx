import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';
import { Download, Settings2, Info, Maximize, Minimize, X, ShieldCheck, ShoppingCart } from 'lucide-react';

interface VaseParams {
  height: number;
  baseRadius: number;
  midRadius1: number;
  midHeight1: number;
  midRadius2: number;
  midHeight2: number;
  topRadius: number;
  thickness: number;
  baseShape: string;
  lowPoly: boolean;
  radialSegments: number;
  verticalSegments: number;
  pattern: string;
  patternDepth: number;
  patternFrequency: number;
  color: string;
  roughness: number;
  metalness: number;
  text: string;
  textFont: string;
  textSize: number;
  textDepth: number;
  textHeightOffset: number;
}

function getShapeMultiplier(shape: string, theta: number): number {
  if (shape === 'circle') return 1;
  if (shape === 'wavy') {
    return 1 + Math.sin(theta * 8) * 0.08;
  }
  
  let n = 3;
  if (shape === 'triangle') n = 3;
  else if (shape === 'square') n = 4;
  else if (shape === 'hexagon') n = 6;
  else return 1;

  const angleStep = (2 * Math.PI) / n;
  let t = theta;
  while (t < 0) t += 2 * Math.PI;
  const localTheta = (t % angleStep) - (angleStep / 2);
  return Math.cos(Math.PI / n) / Math.cos(localTheta);
}

function VaseGeometry({ params, onMeshReady }: { params: VaseParams, onMeshReady: (mesh: THREE.Mesh) => void }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const {
      height,
      baseRadius,
      midRadius1,
      midHeight1,
      midRadius2,
      midHeight2,
      topRadius,
      thickness,
      radialSegments,
      verticalSegments,
    } = params;

    const points: THREE.Vector2[] = [];
    
    // Bottom center
    points.push(new THREE.Vector2(0, 0));

    // Outer curve
    const outerCurve = new THREE.SplineCurve([
      new THREE.Vector2(baseRadius, 0),
      new THREE.Vector2(midRadius1, height * midHeight1),
      new THREE.Vector2(midRadius2, height * midHeight2),
      new THREE.Vector2(topRadius, height),
    ]);
    const outerPoints = outerCurve.getPoints(verticalSegments);
    points.push(...outerPoints);

    // Inner curve (reverse order, top to bottom)
    const innerCurve = new THREE.SplineCurve([
      new THREE.Vector2(Math.max(0.1, topRadius - thickness), height),
      new THREE.Vector2(Math.max(0.1, midRadius2 - thickness), height * midHeight2),
      new THREE.Vector2(Math.max(0.1, midRadius1 - thickness), height * midHeight1),
      new THREE.Vector2(Math.max(0.1, baseRadius - thickness), thickness),
    ]);
    const innerPoints = innerCurve.getPoints(verticalSegments);
    points.push(...innerPoints);

    // Inner bottom center
    points.push(new THREE.Vector2(0, thickness));

    const geo = new THREE.LatheGeometry(points, radialSegments);

    if (params.baseShape !== 'circle') {
      const posAttribute = geo.attributes.position;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < posAttribute.count; i++) {
        vertex.fromBufferAttribute(posAttribute, i);
        if (Math.abs(vertex.x) < 0.001 && Math.abs(vertex.z) < 0.001) continue;
        
        const theta = Math.atan2(vertex.z, vertex.x);
        const mult = getShapeMultiplier(params.baseShape, theta);
        vertex.x *= mult;
        vertex.z *= mult;
        posAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
    }

    geo.computeVertexNormals();

    let textImageData: Uint8ClampedArray | null = null;
    if (params.text && params.text.trim() !== '') {
      const canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 2048;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 2048, 2048);
        ctx.fillStyle = 'white';
        const fontSize = params.textSize * 4;
        ctx.font = `bold ${fontSize}px "${params.textFont}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.filter = 'blur(4px)';
        const yPos = 2048 - (params.textHeightOffset / 100) * 2048;
        ctx.fillText(params.text, 1024, yPos);
        textImageData = ctx.getImageData(0, 0, 2048, 2048).data;
      }
    }

    if ((params.pattern !== 'none' && params.patternDepth > 0) || (textImageData && params.textDepth !== 0)) {
      const posAttribute = geo.attributes.position;
      const normAttribute = geo.attributes.normal;
      const vertex = new THREE.Vector3();
      const normal = new THREE.Vector3();
      const profilePointsCount = points.length;

      for (let i = 0; i < posAttribute.count; i++) {
        const j = i % profilePointsCount;
        
        // Only displace the outer wall
        if (j >= 1 && j <= verticalSegments + 1) {
          vertex.fromBufferAttribute(posAttribute, i);
          normal.fromBufferAttribute(normAttribute, i);

          const theta = Math.atan2(vertex.z, vertex.x);
          const y = vertex.y;
          let displacement = 0;
          
          if (params.pattern !== 'none' && params.patternDepth > 0) {
            const freqX = params.patternFrequency;
            const freqY = params.patternFrequency * 0.15;

            switch (params.pattern) {
              case 'ribbed':
                displacement = Math.sin(theta * freqX);
                break;
              case 'rings':
                displacement = Math.sin(y * freqY);
                break;
              case 'twisted':
                displacement = Math.sin(theta * freqX + y * freqY);
                break;
              case 'diamond':
                displacement = Math.abs(Math.sin(theta * freqX + y * freqY)) + Math.abs(Math.sin(theta * freqX - y * freqY)) - 1.0;
                break;
              case 'honeycomb':
                const cx = theta * freqX;
                const cy = y * freqY * 1.5;
                displacement = (Math.sin(cx) + Math.sin(cx * 0.5 + cy * 0.866) + Math.sin(cx * 0.5 - cy * 0.866)) / 3;
                break;
              case 'waves':
                displacement = Math.sin(theta * freqX + Math.sin(y * freqY) * 2);
                break;
              case 'knit':
                const kx = theta * freqX;
                const ky = y * freqY * 2;
                displacement = Math.sin(kx) * Math.cos(ky) + Math.sin(kx * 2 + ky) * 0.5;
                break;
            }
          }

          let textDisplacement = 0;
          if (textImageData && params.textDepth !== 0) {
            let u = 0.5 - (theta - Math.PI / 2) / (2 * Math.PI);
            if (u < 0) u += 1;
            if (u > 1) u -= 1;
            
            let v = y / height;
            
            let px = Math.floor(u * 2048);
            let py = Math.floor((1 - v) * 2048);
            px = Math.max(0, Math.min(2047, px));
            py = Math.max(0, Math.min(2047, py));
            
            const idx = (py * 2048 + px) * 4;
            const intensity = textImageData[idx] / 255.0;
            textDisplacement = intensity * params.textDepth;
          }

          // Fade out near top and bottom (5% each)
          const yPercent = y / height;
          let fade = 1;
          if (yPercent < 0.05) fade = yPercent / 0.05;
          else if (yPercent > 0.95) fade = (1 - yPercent) / 0.05;
          fade = fade * fade * (3 - 2 * fade); // Smoothstep

          const totalDisplacement = (displacement * params.patternDepth * fade) + textDisplacement;
          vertex.addScaledVector(normal, totalDisplacement);
          posAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
      }
      geo.computeVertexNormals();
    }

    return geo;
  }, [params]);

  useEffect(() => {
    if (meshRef.current) {
      onMeshReady(meshRef.current);
    }
  }, [geometry, onMeshReady]);

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial 
        color={params.color} 
        roughness={params.roughness} 
        metalness={params.metalness} 
        clearcoat={0.3}
        clearcoatRoughness={0.2}
        side={THREE.DoubleSide}
        flatShading={params.lowPoly}
      />
    </mesh>
  );
}

function Select({ label, value, options, onChange }: { label: string, value: string, options: {label: string, value: string}[], onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-zinc-700">{label}</label>
      <select 
        value={value} 
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-100 border-transparent focus:border-zinc-900 focus:ring-0 rounded-lg text-sm p-2.5 outline-none cursor-pointer"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange }: { label: string, value: number, min: number, max: number, step?: number, onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-zinc-700">{label}</label>
        <span className="text-xs font-mono text-zinc-500 bg-zinc-100 px-2 py-1 rounded-md">{value}</span>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step} 
        value={value} 
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-900"
      />
    </div>
  );
}

function getPriceInfo(height: number) {
  if (height <= 100) return { size: 'Klein (bis 10cm)', price: 19.90 };
  if (height <= 160) return { size: 'Mittel (bis 16cm)', price: 29.90 };
  return { size: 'Groß (bis 24cm)', price: 39.90 };
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showCookieBanner, setShowCookieBanner] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Check URL for admin flag
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === 'true') {
      setIsAdmin(true);
    }

    // Hidden keyboard shortcut (Ctrl + Shift + A) to toggle admin mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        setIsAdmin(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (document.fullscreenEnabled) {
        containerRef.current?.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable fullscreen: ${err.message}`);
          // Fallback if blocked
          window.open(window.location.href, '_blank');
        });
      } else {
        // Fallback for iframes without allow="fullscreen"
        window.open(window.location.href, '_blank');
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const [params, setParams] = useState<VaseParams>({
    height: 150,
    baseRadius: 40,
    midRadius1: 60,
    midHeight1: 0.33,
    midRadius2: 30,
    midHeight2: 0.66,
    topRadius: 45,
    thickness: 3,
    baseShape: 'circle',
    lowPoly: false,
    radialSegments: 256,
    verticalSegments: 128,
    pattern: 'none',
    patternDepth: 2,
    patternFrequency: 12,
    color: '#f8fafc',
    roughness: 0.2,
    metalness: 0.1,
    text: '',
    textFont: 'Arial',
    textSize: 40,
    textDepth: 1.5,
    textHeightOffset: 50,
  });

  const meshRef = useRef<THREE.Mesh | null>(null);

  const exportSTL = () => {
    if (!meshRef.current) return;
    const exporter = new STLExporter();
    const stlString = exporter.parse(meshRef.current);
    const blob = new Blob([stlString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = 'vrifle_vase.stl';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={containerRef} className="flex flex-col md:flex-row h-screen w-full bg-zinc-50 text-zinc-900 font-sans overflow-hidden relative">
      
      {/* Mobile Overlay */}
      {showControls && (
        <div 
          className="fixed inset-0 bg-black/20 z-10 md:hidden transition-opacity" 
          onClick={() => setShowControls(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed md:relative z-20 bottom-0 left-0 w-full md:w-80 
        bg-white md:border-r border-zinc-200 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-sm 
        transition-transform duration-300 ease-in-out shrink-0
        h-[80vh] md:h-full rounded-t-3xl md:rounded-none
        ${showControls ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}
      `}>
        <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              VRifle Vasen Generator
            </h1>
            <p className="text-sm text-zinc-500 mt-1">Gestalte deine individuelle 3D-Druck Vase</p>
          </div>
          <button 
            className="md:hidden p-2 -mr-2 text-zinc-400 hover:text-zinc-600 bg-zinc-100 rounded-full"
            onClick={() => setShowControls(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-6">
            <h3 className="text-sm font-semibold text-zinc-900">Grundform & Stil</h3>
            <Select 
              label="Grundform" 
              value={params.baseShape} 
              options={[
                { label: 'Rund', value: 'circle' },
                { label: '3-eckig', value: 'triangle' },
                { label: '4-eckig', value: 'square' },
                { label: '6-eckig', value: 'hexagon' },
                { label: 'Wellenform', value: 'wavy' },
              ]}
              onChange={(v) => setParams({...params, baseShape: v})} 
            />
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-700">Low Poly Optik</label>
              <button 
                onClick={() => setParams({...params, lowPoly: !params.lowPoly})}
                className={`w-12 h-6 rounded-full transition-colors relative ${params.lowPoly ? 'bg-zinc-900' : 'bg-zinc-200'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${params.lowPoly ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
            {params.lowPoly && (
              <p className="text-xs text-zinc-500 mt-1">Tipp: Reduziere die Auflösung (Radial/Vertikal) unter "Erweitert" für einen stärkeren Low-Poly-Effekt.</p>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-100 space-y-6">
            <h3 className="text-sm font-semibold text-zinc-900">Maße</h3>
            <Slider label="Höhe (mm)" value={params.height} min={90} max={240} onChange={(v) => setParams({...params, height: v})} />
            <Slider label="Bodenradius (mm)" value={params.baseRadius} min={10} max={100} onChange={(v) => setParams({...params, baseRadius: v})} />
            <Slider label="Mittlerer Radius 1 (mm)" value={params.midRadius1} min={10} max={150} onChange={(v) => setParams({...params, midRadius1: v})} />
            <Slider label="Mittlere Höhe 1 (%)" value={Math.round(params.midHeight1 * 100)} min={10} max={90} onChange={(v) => setParams({...params, midHeight1: v / 100})} />
            <Slider label="Mittlerer Radius 2 (mm)" value={params.midRadius2} min={10} max={150} onChange={(v) => setParams({...params, midRadius2: v})} />
            <Slider label="Mittlere Höhe 2 (%)" value={Math.round(params.midHeight2 * 100)} min={10} max={90} onChange={(v) => setParams({...params, midHeight2: v / 100})} />
            <Slider label="Oberer Radius (mm)" value={params.topRadius} min={10} max={100} onChange={(v) => setParams({...params, topRadius: v})} />
          </div>
          
          <div className="pt-4 border-t border-zinc-100 space-y-6">
            <h3 className="text-sm font-semibold text-zinc-900">Oberflächenstruktur</h3>
            <Select 
              label="Muster" 
              value={params.pattern} 
              options={[
                { label: 'Glatt (Keins)', value: 'none' },
                { label: 'Gerippt (Vertikal)', value: 'ribbed' },
                { label: 'Ringe (Horizontal)', value: 'rings' },
                { label: 'Gedreht (Spiralen)', value: 'twisted' },
                { label: 'Karo / Rauten', value: 'diamond' },
                { label: 'Waben', value: 'honeycomb' },
                { label: 'Wellen', value: 'waves' },
                { label: 'Strickmuster', value: 'knit' },
              ]}
              onChange={(v) => setParams({...params, pattern: v})} 
            />
            {params.pattern !== 'none' && (
              <>
                <Slider label="Muster-Tiefe (mm)" value={params.patternDepth} min={0.5} max={10} step={0.5} onChange={(v) => setParams({...params, patternDepth: v})} />
                <Slider label="Muster-Frequenz" value={params.patternFrequency} min={2} max={50} step={1} onChange={(v) => setParams({...params, patternFrequency: v})} />
              </>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-100 space-y-6">
            <h3 className="text-sm font-semibold text-zinc-900">Text & Gravur</h3>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-700">Text</label>
              <input 
                type="text" 
                value={params.text} 
                onChange={(e) => setParams({...params, text: e.target.value})}
                placeholder="Dein Text..."
                className="w-full bg-zinc-100 border-transparent focus:border-zinc-900 focus:ring-0 rounded-lg text-sm p-2.5 outline-none"
              />
            </div>
            {params.text && (
              <>
                <Select 
                  label="Schriftart" 
                  value={params.textFont} 
                  options={[
                    { label: 'Arial', value: 'Arial' },
                    { label: 'Times New Roman', value: 'Times New Roman' },
                    { label: 'Courier New', value: 'Courier New' },
                    { label: 'Impact', value: 'Impact' },
                    { label: 'Brush Script MT', value: 'Brush Script MT' },
                  ]}
                  onChange={(v) => setParams({...params, textFont: v})} 
                />
                <Slider label="Schriftgröße" value={params.textSize} min={10} max={100} step={1} onChange={(v) => setParams({...params, textSize: v})} />
                <Slider label="Tiefe (Negativ = Gravur)" value={params.textDepth} min={-5} max={5} step={0.5} onChange={(v) => setParams({...params, textDepth: v})} />
                <Slider label="Höhe (Position)" value={params.textHeightOffset} min={0} max={100} step={1} onChange={(v) => setParams({...params, textHeightOffset: v})} />
              </>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-100 space-y-6">
            <h3 className="text-sm font-semibold text-zinc-900">Erweitert</h3>
            <Slider label="Wandstärke (mm)" value={params.thickness} min={0.5} max={10} step={0.5} onChange={(v) => setParams({...params, thickness: v})} />
            <Slider label="Auflösung (Radial)" value={params.radialSegments} min={16} max={256} step={8} onChange={(v) => setParams({...params, radialSegments: v})} />
            <Slider label="Auflösung (Vertikal)" value={params.verticalSegments} min={8} max={128} step={4} onChange={(v) => setParams({...params, verticalSegments: v})} />
          </div>
        </div>

        <div className="p-6 border-t border-zinc-200 bg-zinc-50 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium text-zinc-500">Größe: {getPriceInfo(params.height).size}</p>
              <p className="text-2xl font-bold text-zinc-900">{getPriceInfo(params.height).price.toFixed(2).replace('.', ',')} €</p>
            </div>
            <div className="text-right text-xs text-zinc-400">
              inkl. MwSt.<br/>zzgl. Versand
            </div>
          </div>
          <a 
            href="#"
            onClick={(e) => {
              e.preventDefault();
              alert("Hier kommt später der Link zum Webador-Artikel rein!");
            }}
            className="w-full py-3 px-4 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <ShoppingCart className="w-5 h-5" />
            Jetzt bestellen
          </a>
          
          {isAdmin && (
            <button 
              onClick={exportSTL}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors shadow-sm mt-2"
            >
              <Download className="w-5 h-5" />
              STL Herunterladen (Admin)
            </button>
          )}
        </div>
      </div>

      {/* 3D View */}
      <div className="flex-1 relative cursor-move h-full w-full">
        {/* Mobile Edit Button */}
        <button
          onClick={() => setShowControls(true)}
          className={`
            md:hidden absolute bottom-8 left-1/2 -translate-x-1/2 z-10 
            bg-zinc-900 text-white px-6 py-3 rounded-full shadow-lg 
            flex items-center gap-2 font-medium transition-all duration-300
            ${showControls ? 'opacity-0 pointer-events-none translate-y-8' : 'opacity-100 translate-y-0'}
          `}
        >
          <Settings2 className="w-5 h-5" />
          Vase anpassen
        </button>

        <button
          onClick={toggleFullscreen}
          className="absolute top-4 right-4 z-10 p-2.5 bg-white rounded-xl shadow-sm hover:bg-zinc-50 text-zinc-700 transition-colors border border-zinc-200"
          title={isFullscreen ? "Vollbild beenden" : "Vollbild"}
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </button>
        <Canvas camera={{ position: [200, 200, 200], fov: 45 }} shadows={{ type: THREE.PCFShadowMap }}>
          <color attach="background" args={['#f4f4f5']} />
          
          <ambientLight intensity={0.6} />
          <directionalLight 
            position={[50, 100, 50]} 
            intensity={1.5} 
            castShadow 
            shadow-mapSize={[2048, 2048]}
          />
          <directionalLight position={[-50, 50, -50]} intensity={0.5} />
          
          <VaseGeometry params={params} onMeshReady={(mesh) => meshRef.current = mesh} />
          
          <ContactShadows 
            position={[0, 0, 0]} 
            opacity={0.4} 
            scale={200} 
            blur={2} 
            far={10} 
          />
          
          <OrbitControls 
            makeDefault 
            target={[0, params.height / 2, 0]} 
            minDistance={50}
            maxDistance={500}
            maxPolarAngle={Math.PI / 2 + 0.1}
          />
          
          <Grid 
            infiniteGrid 
            fadeDistance={400} 
            sectionColor="#cbd5e1" 
            cellColor="#e2e8f0" 
            cellSize={10}
            sectionSize={50}
          />
          <Environment preset="city" />
        </Canvas>
      </div>

      {/* Cookie / Privacy Banner */}
      {showCookieBanner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden p-6 text-center">
            <div className="mx-auto w-12 h-12 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
              <ShieldCheck className="w-6 h-6 text-zinc-900" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-900 mb-2">Datenschutz-Info</h2>
            <p className="text-sm text-zinc-600 mb-6">
              Dieser 3D-Generator verwendet <strong>keine Cookies</strong> und speichert keine persönlichen Daten. 
              Die Erstellung deines 3D-Modells erfolgt komplett lokal in deinem Browser.
            </p>
            <button 
              onClick={() => setShowCookieBanner(false)}
              className="w-full py-3 px-4 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl font-medium transition-colors"
            >
              Okay, verstanden
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
