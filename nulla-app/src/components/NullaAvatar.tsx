import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// CONFIGURATION - THE SWARM
const COUNT = 1500; // Number of "Data Squares"
const RADIUS = 3.5; // Size of the ring

export type NullaState = 'idle' | 'alert' | 'thinking' | 'speaking' | 'glitch';

interface NullaRingProps {
  state: NullaState;
}

// Simple noise function for organic movement
function noise(x: number, y: number, z: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

// Curl noise for typhoon effect
function curlNoise(x: number, y: number, z: number, t: number): [number, number, number] {
  const eps = 0.01;
  const dx = (noise(x + eps, y, z + t) - noise(x - eps, y, z + t)) / (2 * eps);
  const dy = (noise(x, y + eps, z + t) - noise(x, y - eps, z + t)) / (2 * eps);
  const dz = (noise(x, y, z + eps + t) - noise(x, y, z - eps + t)) / (2 * eps);
  return [dy - dz, dz - dx, dx - dy];
}

export const NullaRing = ({ state }: NullaRingProps) => {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  // Store particle data
  const particles = useMemo(() => {
    return new Array(COUNT).fill(0).map((_, i) => {
      const angle = (i / COUNT) * Math.PI * 2;
      return {
        angle,
        baseRadius: RADIUS + (Math.random() - 0.5) * 0.4,
        speed: 0.3 + Math.random() * 0.7,
        yOffset: (Math.random() - 0.5) * 1.2,
        glitchOffset: 0,
        phase: Math.random() * Math.PI * 2,
        layer: Math.floor(Math.random() * 3), // Depth layers
        velocity: { x: 0, y: 0, z: 0 },
      };
    });
  }, []);

  // Breathing rhythm (organic, not sine wave)
  const breathe = (time: number): number => {
    const primary = Math.sin(time * 0.5) * 0.5 + 0.5;
    const secondary = Math.sin(time * 1.3 + 0.5) * 0.2;
    const tertiary = noise(time * 0.2, 0, 0) * 0.1;
    return primary + secondary + tertiary;
  };

  useFrame((threeState) => {
    if (!mesh.current) return;
    const time = threeState.clock.getElapsedTime();
    const breath = breathe(time);

    particles.forEach((p, i) => {
      let { angle, baseRadius, yOffset, phase, layer } = p;
      let radius = baseRadius;
      let scale = 0.08;
      let y = Math.sin(time * p.speed + phase) * yOffset * 0.5;
      
      // ═══════════════════════════════════════════════════════════
      // STATE: IDLE - "The Breathing Beast"
      // Cosmic egg, dormant singularity, organic pulse
      // ═══════════════════════════════════════════════════════════
      if (state === 'idle') {
        // Organic breathing - expands and contracts
        const breathScale = 0.9 + breath * 0.2;
        radius = baseRadius * breathScale;
        
        // Slow drift rotation
        angle += time * 0.05;
        
        // Depth layers create parallax
        const layerOffset = layer * 0.15;
        radius += layerOffset;
        
        // Random glitch sparks (dreaming)
        if (Math.random() > 0.997) {
          p.glitchOffset = (Math.random() - 0.5) * 2.0;
        }
        p.glitchOffset *= 0.92; // Decay
        radius += p.glitchOffset;
        
        // Subtle scale pulsing
        scale = 0.05 + Math.sin(time * 2 + i * 0.05) * 0.02 + breath * 0.02;
        
        // Vertical breathing
        y *= (0.8 + breath * 0.4);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STATE: ALERT - "The Awakening"
      // User started typing - Nulla notices, tightens focus
      // ═══════════════════════════════════════════════════════════
      else if (state === 'alert') {
        // Tighten inward - predator sensing prey
        const tighten = 0.85;
        radius = baseRadius * tighten;
        
        // Faster rotation - alert
        angle += time * 0.15;
        
        // Reduce vertical spread - focusing
        y *= 0.5;
        
        // Sharper, more defined squares
        scale = 0.07 + Math.sin(time * 4 + i * 0.1) * 0.01;
        
        // Subtle pulse toward center
        const pulse = Math.sin(time * 3) * 0.1;
        radius += pulse;
      }
      
      // ═══════════════════════════════════════════════════════════
      // STATE: THINKING - "The Information Typhoon"
      // User hit Enter - STORM BEGINS
      // ═══════════════════════════════════════════════════════════
      else if (state === 'thinking') {
        // Phase 1: Vortex formation
        const vortexTime = time * 4;
        
        // Curl noise for swirling motion
        const [cx, cy, cz] = curlNoise(
          Math.cos(angle) * 0.5,
          y * 0.5,
          Math.sin(angle) * 0.5,
          time * 0.5
        );
        
        // Apply curl velocity
        p.velocity.x = p.velocity.x * 0.95 + cx * 0.15;
        p.velocity.y = p.velocity.y * 0.95 + cy * 0.15;
        p.velocity.z = p.velocity.z * 0.95 + cz * 0.15;
        
        // Collapse and expand cycle
        const collapse = Math.sin(vortexTime * 0.5) * 0.5 + 0.5;
        radius = baseRadius * (0.2 + collapse * 0.8);
        
        // Rapid rotation - data tornado
        angle += time * 2.5 + Math.sin(time * 3) * 0.8;
        
        // Vertical chaos
        y = Math.sin(time * 5 + i * 0.15) * 2.0 * (1 - collapse * 0.5);
        y += p.velocity.y * 2;
        
        // Add curl offset to position
        radius += p.velocity.x * 1.5;
        
        // Dynamic scale - chaos
        scale = 0.04 + Math.random() * 0.12;
        
        // Fibonacci spiral hint
        const fibonacci = Math.sin(angle * 1.618 + time * 2) * 0.3;
        radius += fibonacci * (1 - collapse);
      }
      
      // ═══════════════════════════════════════════════════════════
      // STATE: SPEAKING - "The Revelation"
      // Response ready - calm mandala, light rays
      // ═══════════════════════════════════════════════════════════
      else if (state === 'speaking') {
        // Calm, organized pulse
        const pulse = Math.sin(time * 6) * 0.12;
        const wave = Math.sin(angle * 12 + time * 4) * 0.06;
        radius = baseRadius + pulse + wave;
        
        // Slow majestic rotation
        angle += time * 0.2;
        
        // Minimal vertical - stability
        y *= 0.2;
        
        // Larger, more solid squares - confidence
        scale = 0.1 + pulse * 0.2;
        
        // Outward ray effect
        if (i % 20 === 0) {
          radius += Math.sin(time * 8) * 0.3;
          scale *= 1.5;
        }
      }
      
      // ═══════════════════════════════════════════════════════════
      // STATE: GLITCH - "Error/Alert"
      // Something wrong - chaotic breakdown
      // ═══════════════════════════════════════════════════════════
      else if (state === 'glitch') {
        // Pure chaos
        const chaos = Math.sin(time * 15 + i * 0.5) * 0.6;
        radius = baseRadius + chaos + (Math.random() - 0.5) * 0.8;
        
        // Erratic rotation
        angle += time * 0.8 + Math.random() * 0.2;
        
        // Violent vertical
        y = Math.sin(time * 8 + i * 0.4) * 2.0;
        
        // Flickering scale
        scale = 0.03 + Math.random() * 0.15;
      }

      // Update position
      dummy.position.set(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      );
      
      // Rotation based on state
      const rotSpeed = state === 'thinking' ? 2 : state === 'glitch' ? 3 : 0.5;
      dummy.rotation.set(
        time * rotSpeed * 0.5,
        time * rotSpeed * 0.3,
        time * rotSpeed * 0.2
      );
      
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  // Color based on state
  const color = useMemo(() => {
    switch (state) {
      case 'alert': return '#00ddff';    // Bright cyan - aware
      case 'thinking': return '#00ffff'; // Electric cyan - processing
      case 'speaking': return '#00ff88'; // Bright green - transmitting
      case 'glitch': return '#ff0044';   // Red - error
      default: return '#00ff41';         // Matrix green - dormant
    }
  }, [state]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
};

// Central void core - the "eye"
export const VoidCore = ({ state }: { state: NullaState }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  
  useFrame((threeState) => {
    if (!meshRef.current || !ringRef.current) return;
    const time = threeState.clock.getElapsedTime();
    
    // Core size based on state
    let baseScale = 0.3;
    let pulse = 0;
    
    switch (state) {
      case 'idle':
        baseScale = 0.25;
        pulse = Math.sin(time * 0.5) * 0.05; // Slow breathing
        break;
      case 'alert':
        baseScale = 0.35;
        pulse = Math.sin(time * 2) * 0.03; // Quick pulse
        break;
      case 'thinking':
        baseScale = 0.8 + Math.sin(time * 4) * 0.3; // Expanding/contracting
        pulse = 0;
        break;
      case 'speaking':
        baseScale = 0.4;
        pulse = Math.sin(time * 6) * 0.1; // Strong pulse
        break;
      case 'glitch':
        baseScale = 0.3 + Math.random() * 0.3; // Erratic
        pulse = 0;
        break;
    }
    
    meshRef.current.scale.setScalar(baseScale + pulse);
    meshRef.current.rotation.z = time * (state === 'thinking' ? 2 : 0.5);
    
    // Outer ring
    ringRef.current.scale.setScalar((baseScale + pulse) * 1.5);
    ringRef.current.rotation.z = -time * 0.3;
  });
  
  const coreColor = state === 'glitch' ? '#ff0044' : 
                    state === 'thinking' ? '#00ffff' : '#00ff88';
  
  return (
    <group>
      {/* Inner core */}
      <mesh ref={meshRef}>
        <ringGeometry args={[0.2, 0.4, 32]} />
        <meshBasicMaterial 
          color={coreColor} 
          toneMapped={false} 
          transparent 
          opacity={state === 'idle' ? 0.4 : 0.7} 
        />
      </mesh>
      
      {/* Outer glow ring */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.5, 0.55, 64]} />
        <meshBasicMaterial 
          color={coreColor} 
          toneMapped={false} 
          transparent 
          opacity={0.3} 
        />
      </mesh>
    </group>
  );
};
