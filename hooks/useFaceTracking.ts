"use client";

import { useEffect, useRef, useState } from "react";
import { FaceMetrics } from "@/lib/interview-types";

const INITIAL_METRICS: FaceMetrics = {
  eyeContact: 50,
  headStability: 50,
  engagementScore: 50
};

type MediaPipeResults = {
  multiFaceLandmarks?: Array<
    Array<{
      x: number;
      y: number;
      z: number;
    }>
  >;
};

type FaceMeshInstance = {
  setOptions: (options: Record<string, unknown>) => void;
  onResults: (callback: (results: MediaPipeResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close?: () => Promise<void> | void;
};

export function useFaceTracking() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
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

        const selectedDevice = cameras[selectedDeviceIndex % Math.max(cameras.length, 1)];
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
          const headStability = 100 - Math.min(100, Math.abs(nose.x - 0.5) * 180 + Math.abs(chin.y - 0.78) * 250);
          const engagementScore = Math.round((eyeAlignment + headStability) / 2);

          setMetrics({
            eyeContact: Math.round(eyeAlignment),
            headStability: Math.round(headStability),
            engagementScore
          });
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

      mediaStream?.getTracks().forEach((track) => track.stop());
      void faceMesh?.close?.();
    };
  }, [selectedDeviceIndex]);

  const cycleCamera = async () => {
    let cameras = videoDevices;

    if (navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      cameras = devices.filter((device) => device.kind === "videoinput");
      setVideoDevices(cameras);
    }

    if (cameras.length <= 1) {
      return;
    }

    setSelectedDeviceIndex((current) => (current + 1) % cameras.length);
  };

  return {
    videoRef,
    metrics,
    isReady,
    permissionError,
    videoDevices,
    selectedDevice: videoDevices[selectedDeviceIndex % Math.max(videoDevices.length, 1)] ?? null,
    cycleCamera
  };
}
