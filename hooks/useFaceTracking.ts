"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceEmotionScores, FaceMetrics } from "@/lib/interview-types";
import { pickDominantEmotion } from "@/lib/interview-scoring";

const INITIAL_EMOTION: FaceEmotionScores = {
  happy: 0,
  sad: 0,
  nervous: 0,
  neutral: 100,
  dominant: "neutral"
};

const INITIAL_METRICS: FaceMetrics = {
  eyeContact: 50,
  headStability: 50,
  engagementScore: 50,
  emotion: INITIAL_EMOTION
};

type MediaPipeResults = {
  multiFaceLandmarks?: Array<FaceLandmark[]>;
};

type FaceLandmark = {
  x: number;
  y: number;
  z: number;
};

type FaceMeshInstance = {
  setOptions: (options: Record<string, unknown>) => void;
  onResults: (callback: (results: MediaPipeResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close?: () => Promise<void> | void;
};

function clampLocal(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function eyeContactBorderColor(eyeContactRounded: number): string {
  if (eyeContactRounded >= 70) {
    return "#22c55e";
  }

  if (eyeContactRounded >= 40) {
    return "#f97316";
  }

  return "#ef4444";
}

function syncCanvasToVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function getBoundingBox(landmarks: FaceLandmark[], width: number, height: number, indices?: number[]) {
  const points = indices ? indices.map((index) => landmarks[index]).filter(Boolean) : landmarks;

  if (points.length === 0) {
    return null;
  }

  const xs = points.map((point) => point.x * width);
  const ys = points.map((point) => point.y * height);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function strokeBoundingBox(ctx: CanvasRenderingContext2D, box: ReturnType<typeof getBoundingBox>, color: string, lineWidth: number) {
  if (!box) {
    return;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
}

export function useFaceTracking(preferredDeviceId?: string | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const blinkTimestampsRef = useRef<number[]>([]);
  const prevEyeOpenRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<FaceMetrics>(INITIAL_METRICS);
  const [isReady, setIsReady] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let animationFrameId: number | null = null;
    let mediaStream: MediaStream | null = null;
    let faceMesh: FaceMeshInstance | null = null;

    blinkTimestampsRef.current = [];
    prevEyeOpenRef.current = null;

    async function setup() {
      if (!videoRef.current) {
        return;
      }

      try {
        const [{ FaceMesh }] = await Promise.all([import("@mediapipe/face_mesh")]);

        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((device) => device.kind === "videoinput");
        if (isMounted && cameras.length > 0) {
          setVideoDevices(cameras);
        }

        const preferredDeviceIndex = preferredDeviceId ? cameras.findIndex((device) => device.deviceId === preferredDeviceId) : -1;
        const resolvedDeviceIndex =
          preferredDeviceIndex >= 0 && selectedDeviceIndex === 0
            ? preferredDeviceIndex
            : selectedDeviceIndex % Math.max(cameras.length, 1);
        const selectedDevice = cameras[resolvedDeviceIndex];
        if (isMounted && cameras.length > 0 && resolvedDeviceIndex !== selectedDeviceIndex) {
          setSelectedDeviceIndex(resolvedDeviceIndex);
        }
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 640,
            height: 480,
            ...(selectedDevice ? { deviceId: { exact: selectedDevice.deviceId } } : { facingMode: "user" })
          },
          audio: false
        });

        const video = videoRef.current;
        video.srcObject = mediaStream;
        await video.play();

        faceMesh = new FaceMesh({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
        }) as FaceMeshInstance;

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        faceMesh.onResults((results: MediaPipeResults) => {
          if (!isMounted) {
            return;
          }

          const canvas = canvasRef.current;
          const video = videoRef.current;
          const ctx = canvas?.getContext("2d");

          if (canvas && video && ctx) {
            syncCanvasToVideo(canvas, video);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }

          const landmarks = results.multiFaceLandmarks?.[0];
          if (!landmarks) {
            setMetrics(INITIAL_METRICS);
            return;
          }

          const leftEye = landmarks[33];
          const rightEye = landmarks[263];
          const nose = landmarks[1];
          const chin = landmarks[152];

          const eyeAlignment = 100 - Math.min(100, Math.abs(leftEye.z - rightEye.z) * 1200);
          const headStabilityRaw = 100 - Math.min(100, Math.abs(nose.x - 0.5) * 180 + Math.abs(chin.y - 0.78) * 250);
          const headStability = Math.round(headStabilityRaw);
          const eyeContactRounded = Math.round(eyeAlignment);
          const engagementScore = Math.round((eyeAlignment + headStabilityRaw) / 2);

          const smileWidth = Math.abs(landmarks[61].x - landmarks[291].x);
          const happy = clampLocal(Math.min(100, smileWidth * 500), 0, 100);

          const mouthOpen = Math.abs(landmarks[13].y - landmarks[14].y);
          const sad = clampLocal((0.022 - mouthOpen) * 2800, 0, 100);

          const leftEyeOpen = Math.abs(landmarks[159].y - landmarks[145].y);
          const rightEyeOpen = Math.abs(landmarks[386].y - landmarks[374].y);
          const eyeOpenAvg = (leftEyeOpen + rightEyeOpen) / 2;

          const now = performance.now();
          if (prevEyeOpenRef.current !== null && prevEyeOpenRef.current > 0.024 && eyeOpenAvg < 0.014) {
            blinkTimestampsRef.current.push(now);
          }
          prevEyeOpenRef.current = eyeOpenAvg;

          blinkTimestampsRef.current = blinkTimestampsRef.current.filter((timestamp) => now - timestamp < 900);
          const blinkBurstScore = Math.min(100, blinkTimestampsRef.current.length * 22);

          const blinkFactor = eyeOpenAvg < 0.009 ? 1 : 0;
          const nervous = clampLocal(blinkFactor * 55 + blinkBurstScore * 0.35 + (100 - headStabilityRaw) * 0.38, 0, 100);

          // Neutral is the inverse of the strongest active emotion.
          // High when the face is calm and composed; drops as any emotion rises.
          const neutral = clampLocal(100 - Math.max(happy, sad, nervous), 0, 100);

          const dominant = pickDominantEmotion(happy, sad, nervous, neutral);
          const emotion: FaceEmotionScores = {
            happy,
            sad,
            nervous,
            neutral,
            dominant
          };

          setMetrics({
            eyeContact: eyeContactRounded,
            headStability,
            engagementScore,
            emotion
          });

          if (ctx && canvas) {
            const faceBox = getBoundingBox(landmarks, canvas.width, canvas.height);
            strokeBoundingBox(ctx, faceBox, eyeContactBorderColor(eyeContactRounded), 3);
          }
        });

        const processFrame = async () => {
          if (!isMounted || !faceMesh || !videoRef.current) {
            return;
          }

          try {
            if (videoRef.current.readyState >= 2) {
              await faceMesh.send({ image: videoRef.current });
            }
          } catch (error) {
            if (isMounted) {
              setPermissionError(error instanceof Error ? error.message : "Face tracking became unavailable.");
              setIsReady(false);
            }
            return;
          }

          animationFrameId = window.requestAnimationFrame(() => {
            void processFrame();
          });
        };

        if (isMounted) {
          setIsReady(true);
          setPermissionError(null);
          void processFrame();
        }
      } catch (error) {
        if (isMounted) {
          setPermissionError(error instanceof Error ? error.message : "Webcam tracking was not available.");
          setIsReady(false);
        }
      }
    }

    void setup();

    return () => {
      isMounted = false;

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      blinkTimestampsRef.current = [];
      prevEyeOpenRef.current = null;

      mediaStream?.getTracks().forEach((track) => track.stop());
      void faceMesh?.close?.();
    };
  }, [preferredDeviceId, selectedDeviceIndex]);

  const refreshVideoDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return videoDevices;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    setVideoDevices(cameras);

    return cameras;
  };

  const cycleCamera = async () => {
    let cameras = videoDevices;

    cameras = await refreshVideoDevices();

    if (cameras.length <= 1) {
      return;
    }

    setSelectedDeviceIndex((current) => (current + 1) % cameras.length);
  };

  const selectCamera = async (index: number) => {
    const cameras = await refreshVideoDevices();

    if (cameras.length === 0) {
      return;
    }

    setSelectedDeviceIndex(Math.max(0, Math.min(index, cameras.length - 1)));
  };

  return {
    videoRef,
    canvasRef,
    metrics,
    isReady,
    permissionError,
    videoDevices,
    selectedDeviceIndex,
    selectedDevice: videoDevices[selectedDeviceIndex % Math.max(videoDevices.length, 1)] ?? null,
    cycleCamera,
    selectCamera
  };
}
