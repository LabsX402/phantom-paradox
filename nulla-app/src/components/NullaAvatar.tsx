import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// CONFIGURATION
const COUNT = 1200; // Number of "Data Squares"
const RADIUS = 3;   // Size of the ring

export type NullaState = 'idle' | 'thinking' | 'speaking' | 'glitch';

interface NullaRingProps {
  state: NullaState;
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
        baseRadius: RADIUS + (Math.random() - 0.5) * 0.3,
        speed: 0.5 + Math.random() * 0.5,
        yOffset: (Math.random() - 0.5) * 0.8,
        glitchOffset: 0,
        phase: Math.random() * Math.PI * 2,
      };
    });
  }, []);

  useFrame((threeState) => {
    if (!mesh.current) return;
    const time = threeState.clock.getElapsedTime();

    particles.forEach((p, i) => {
      let { angle, baseRadius, yOffset, phase } = p;
      let radius = baseRadius;
      let scale = 0.08;
      let y = Math.sin(time * p.speed + phase) * yOffset * 0.5;
      
      // === STATE: IDLE (The Glitch) ===
      if (state === 'idle') {
        angle += time * 0.1;
        // Random glitch jitter
        if (Math.random() > 0.995) {
          p.glitchOffset = (Math.random() - 0.5) * 1.5;
        }
        p.glitchOffset *= 0.95; // Decay
        radius += p.glitchOffset;
        scale = 0.06 + Math.sin(time * 2 + i * 0.1) * 0.02;
      }
      
      // === STATE: THINKING (The Build) ===
      else if (state === 'thinking') {
        const swirl = Math.sin(time * 4 + i * 0.05);
        const collapse = Math.sin(time * 2) * 0.5 + 0.5; // 0 to 1
        radius = baseRadius * (0.3 + collapse * 0.7) + swirl * 0.3;
        angle += time * 1.5 + Math.sin(time * 3) * 0.5;
        y = Math.sin(time * 3 + i * 0.1) * 1.5 * (1 - collapse);
        scale = 0.04 + Math.random() * 0.08;
      }
      
      // === STATE: SPEAKING (The Pulse) ===
      else if (state === 'speaking') {
        const pulse = Math.sin(time * 8) * 0.15;
        const wave = Math.sin(angle * 8 + time * 6) * 0.08;
        radius = baseRadius + pulse + wave;
        angle += time * 0.2;
        scale = 0.1 + pulse * 0.3;
        y *= 0.3; // Less vertical movement
      }
      
      // === STATE: GLITCH (Error/Alert) ===
      else if (state === 'glitch') {
        // Chaotic movement
        const chaos = Math.sin(time * 10 + i) * 0.5;
        radius = baseRadius + chaos + (Math.random() - 0.5) * 0.5;
        angle += time * 0.5 + Math.random() * 0.1;
        y = Math.sin(time * 5 + i * 0.3) * 1.5;
        scale = 0.05 + Math.random() * 0.1;
      }

      // Update position
      dummy.position.set(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      );
      
      dummy.rotation.set(time * 0.5, time * 0.3, time * 0.2);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });
    
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  // Color based on state
  const color = useMemo(() => {
    switch (state) {
      case 'thinking': return '#00ffff'; // Cyan
      case 'speaking': return '#00ff88'; // Green
      case 'glitch': return '#ff0044';   // Red
      default: return '#00ff41';         // Matrix green
    }
  }, [state]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
};

// Central void effect
export const VoidCore = ({ state }: { state: NullaState }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((threeState) => {
    if (!meshRef.current) return;
    const time = threeState.clock.getElapsedTime();
    
    const baseScale = state === 'thinking' ? 0.8 : 0.3;
    const pulse = Math.sin(time * (state === 'speaking' ? 8 : 2)) * 0.1;
    meshRef.current.scale.setScalar(baseScale + pulse);
    meshRef.current.rotation.z = time * 0.5;
  });
  
  const color = state === 'glitch' ? '#ff0044' : '#00ff88';
  
  return (
    <mesh ref={meshRef}>
      <ringGeometry args={[0.3, 0.5, 32]} />
      <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.6} />
    </mesh>
  );
};

