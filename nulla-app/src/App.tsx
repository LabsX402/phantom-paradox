import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, Glitch } from '@react-three/postprocessing';
import { NullaRing, VoidCore, type NullaState } from './components/NullaAvatar';
import { NullaChat } from './components/NullaChat';
import './App.css';

function App() {
  const [nullaState, setNullaState] = useState<NullaState>('idle');

  return (
    <div className="app">
      {/* 3D Avatar */}
      <div className="avatar-container">
        <Canvas camera={{ position: [0, 0, 8], fov: 50 }}>
          <color attach="background" args={['#000000']} />
          
          <NullaRing state={nullaState} />
          <VoidCore state={nullaState} />
          
          {/* Post Processing */}
          <EffectComposer>
            <Bloom 
              luminanceThreshold={0.1} 
              intensity={nullaState === 'speaking' ? 3.0 : 1.5} 
              radius={0.8} 
            />
            <Glitch 
              active={nullaState === 'thinking' || nullaState === 'glitch'} 
              ratio={nullaState === 'glitch' ? 0.95 : 0.5}
              delay={[0.5, 1.5] as [number, number]}
            />
          </EffectComposer>
        </Canvas>
        
        {/* State indicator */}
        <div className="state-badge" data-state={nullaState}>
          {nullaState.toUpperCase()}
        </div>
      </div>
      
      {/* Chat Interface */}
      <div className="chat-container">
        <NullaChat 
          onStateChange={setNullaState}
          currentState={nullaState}
        />
      </div>
      
      {/* Background grid */}
      <div className="grid-bg" />
    </div>
  );
}

export default App;

