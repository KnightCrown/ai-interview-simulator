export interface MediaDevicePreferences {
  audioInputId: string;
  videoInputId: string;
  mediaPermissionGranted?: boolean;
}

const STORAGE_KEY = "ai-interview-simulator-media-devices";

export function loadMediaDevicePreferences(): MediaDevicePreferences | null {
  if (typeof window === "undefined") {
    return null;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<MediaDevicePreferences>;

    return {
      audioInputId: typeof parsed.audioInputId === "string" ? parsed.audioInputId : "",
      videoInputId: typeof parsed.videoInputId === "string" ? parsed.videoInputId : "",
      mediaPermissionGranted: parsed.mediaPermissionGranted === true
    };
  } catch {
    return null;
  }
}

export function saveMediaDevicePreferences(preferences: MediaDevicePreferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function markMediaPermissionGranted() {
  const current = loadMediaDevicePreferences();
  saveMediaDevicePreferences({
    audioInputId: current?.audioInputId ?? "",
    videoInputId: current?.videoInputId ?? "",
    mediaPermissionGranted: true
  });
}
