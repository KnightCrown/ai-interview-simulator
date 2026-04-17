"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AvatarEmotion } from "@/lib/avatar-utils";

function AvatarModel({ mouthLevel, emotion, isSpeaking }: { mouthLevel: number; emotion: AvatarEmotion; isSpeaking: boolean }) {
  const rootRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);
  const leftLidRef = useRef<THREE.Mesh>(null);
  const rightLidRef = useRef<THREE.Mesh>(null);
  const browLeftRef = useRef<THREE.Mesh>(null);
  const browRightRef = useRef<THREE.Mesh>(null);
  const [blinkAmount, setBlinkAmount] = useState(0);

  useEffect(() => {
    let timeoutId: number | null = null;

    const scheduleBlink = () => {
      timeoutId = window.setTimeout(() => {
        setBlinkAmount(1);
        window.setTimeout(() => setBlinkAmount(0), 140);
        scheduleBlink();
      }, 1800 + Math.random() * 2200);
    };

    scheduleBlink();

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const moodColor = useMemo(() => {
    if (emotion === "positive") {
      return new THREE.Color("#14b8a6");
    }
    if (emotion === "negative") {
      return new THREE.Color("#f97316");
    }
    return new THREE.Color("#38bdf8");
  }, [emotion]);

  useFrame(({ camera, clock }) => {
    const elapsed = clock.getElapsedTime();
    const breath = 1 + Math.sin(elapsed * 1.6) * 0.025;
    const sway = Math.sin(elapsed * 0.8) * 0.08;
    const talkOpen = 0.12 + mouthLevel * (isSpeaking ? 0.75 : 0.4);
    const lidScale = blinkAmount > 0 ? 0.08 : 1;
    const browTilt = emotion === "negative" ? -0.35 : emotion === "positive" ? 0.2 : 0;

    if (rootRef.current) {
      rootRef.current.rotation.y = THREE.MathUtils.lerp(rootRef.current.rotation.y, sway, 0.08);
      rootRef.current.position.y = THREE.MathUtils.lerp(rootRef.current.position.y, Math.sin(elapsed * 1.6) * 0.03, 0.08);
    }

    if (bodyRef.current) {
      bodyRef.current.scale.y = THREE.MathUtils.lerp(bodyRef.current.scale.y, breath, 0.08);
    }

    if (headRef.current) {
      headRef.current.lookAt(camera.position.x * 0.35, camera.position.y * 0.15, camera.position.z);
    }

    if (mouthRef.current) {
      mouthRef.current.scale.y = THREE.MathUtils.lerp(mouthRef.current.scale.y, talkOpen, 0.15);
      mouthRef.current.scale.x = THREE.MathUtils.lerp(
        mouthRef.current.scale.x,
        emotion === "positive" ? 1.25 : emotion === "negative" ? 0.9 : 1,
        0.12
      );
      mouthRef.current.position.y = THREE.MathUtils.lerp(
        mouthRef.current.position.y,
        emotion === "positive" ? -0.63 : emotion === "negative" ? -0.7 : -0.66,
        0.15
      );
    }

    if (leftLidRef.current && rightLidRef.current) {
      leftLidRef.current.scale.y = THREE.MathUtils.lerp(leftLidRef.current.scale.y, lidScale, 0.25);
      rightLidRef.current.scale.y = THREE.MathUtils.lerp(rightLidRef.current.scale.y, lidScale, 0.25);
    }

    if (browLeftRef.current && browRightRef.current) {
      browLeftRef.current.rotation.z = THREE.MathUtils.lerp(browLeftRef.current.rotation.z, browTilt, 0.12);
      browRightRef.current.rotation.z = THREE.MathUtils.lerp(browRightRef.current.rotation.z, -browTilt, 0.12);
    }
  });

  return (
    <Float speed={1.1} rotationIntensity={0.08} floatIntensity={0.12}>
      <group ref={rootRef} position={[0, -0.2, 0]}>
        <mesh ref={bodyRef} position={[0, -1.15, 0]}>
          <cylinderGeometry args={[0.62, 0.74, 1.7, 28]} />
          <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.15} />
        </mesh>

        <mesh position={[0, -0.1, 0.1]}>
          <torusGeometry args={[0.75, 0.06, 20, 60]} />
          <meshStandardMaterial color="#f59e0b" roughness={0.25} metalness={0.35} />
        </mesh>

        <mesh ref={headRef} position={[0, 0.7, 0]}>
          <sphereGeometry args={[0.84, 40, 40]} />
          <meshStandardMaterial color="#f8d6bf" roughness={0.82} />
        </mesh>

        <mesh position={[0, 1.58, 0.04]}>
          <sphereGeometry args={[0.68, 32, 32]} />
          <meshStandardMaterial color="#111827" roughness={0.45} />
        </mesh>

        <mesh position={[-0.28, 0.83, 0.71]}>
          <sphereGeometry args={[0.11, 20, 20]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.28, 0.83, 0.71]}>
          <sphereGeometry args={[0.11, 20, 20]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[-0.28, 0.83, 0.8]}>
          <sphereGeometry args={[0.045, 20, 20]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        <mesh position={[0.28, 0.83, 0.8]}>
          <sphereGeometry args={[0.045, 20, 20]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>

        <mesh ref={leftLidRef} position={[-0.28, 0.9, 0.76]}>
          <boxGeometry args={[0.25, 0.14, 0.04]} />
          <meshStandardMaterial color="#f8d6bf" />
        </mesh>
        <mesh ref={rightLidRef} position={[0.28, 0.9, 0.76]}>
          <boxGeometry args={[0.25, 0.14, 0.04]} />
          <meshStandardMaterial color="#f8d6bf" />
        </mesh>

        <mesh ref={browLeftRef} position={[-0.28, 1.08, 0.74]}>
          <boxGeometry args={[0.28, 0.045, 0.045]} />
          <meshStandardMaterial color="#3f2b1f" />
        </mesh>
        <mesh ref={browRightRef} position={[0.28, 1.08, 0.74]}>
          <boxGeometry args={[0.28, 0.045, 0.045]} />
          <meshStandardMaterial color="#3f2b1f" />
        </mesh>

        <mesh position={[0, 0.54, 0.79]}>
          <coneGeometry args={[0.08, 0.22, 10]} />
          <meshStandardMaterial color="#efc8af" roughness={0.8} />
        </mesh>

        <mesh ref={mouthRef} position={[0, -0.66, 0.79]} scale={[1, 0.12, 1]}>
          <sphereGeometry args={[0.16, 20, 20]} />
          <meshStandardMaterial color={moodColor} emissive={moodColor} emissiveIntensity={0.12} roughness={0.3} />
        </mesh>

        <mesh position={[-0.68, -1.2, 0]}>
          <capsuleGeometry args={[0.13, 0.8, 6, 12]} />
          <meshStandardMaterial color="#0f172a" roughness={0.45} />
        </mesh>
        <mesh position={[0.68, -1.2, 0]}>
          <capsuleGeometry args={[0.13, 0.8, 6, 12]} />
          <meshStandardMaterial color="#0f172a" roughness={0.45} />
        </mesh>
      </group>
    </Float>
  );
}

export function InterviewerAvatar({
  className = "",
  mouthLevel,
  emotion,
  isSpeaking,
  compact = false,
  onClick,
  title
}: {
  className?: string;
  mouthLevel: number;
  emotion: AvatarEmotion;
  isSpeaking: boolean;
  compact?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-[1.8rem] border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.24),transparent_36%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] text-left shadow-panel ${className}`}
    >
      <div className="absolute left-4 top-4 z-10">
        <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 backdrop-blur">
          {title ?? "AI interviewer"}
        </div>
        <div className="mt-2 rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200 backdrop-blur">
          {isSpeaking ? "Speaking live" : "Listening"}
        </div>
      </div>

      <div className={compact ? "h-full min-h-[180px] w-full" : "h-full min-h-[360px] w-full"}>
        <Canvas camera={{ position: [0, 0.45, 4.8], fov: compact ? 34 : 30 }}>
          <ambientLight intensity={1.2} />
          <directionalLight position={[2, 4, 3]} intensity={2.2} />
          <pointLight position={[-2, 3, 4]} intensity={0.9} color="#a855f7" />
          <Environment preset="city" />
          <AvatarModel mouthLevel={mouthLevel} emotion={emotion} isSpeaking={isSpeaking} />
        </Canvas>
      </div>
    </button>
  );
}
