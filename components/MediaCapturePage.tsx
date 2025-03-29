"use client";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, Camera, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function MediaCapturePage() {
  const [hasPermissions, setHasPermissions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const checkPermissions = async () => {
    try {
      const result = await navigator.permissions.query({ name: "camera" as PermissionName });
      if (result.state === "granted") {
        setHasPermissions(true);
        setStatus("Ready to record");
        setupMediaStream();
      } else {
        setStatus("Requesting permissions...");
        requestPermissions();
      }
    } catch (err) {
      setStatus("Requesting permissions...");
      requestPermissions();
    }
  };

  const requestPermissions = async () => {
    if (!isClient) return;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("MediaDevices API not supported");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: facingMode },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setHasPermissions(true);
      setStatus("Ready to record");
    } catch (err) {
      setError(`Permission error: ${err instanceof Error ? err.message : String(err)}`);
      setStatus("Permission denied");
    }
  };

  const setupMediaStream = async () => {
    if (!isClient || !hasPermissions) return;

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: facingMode },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError(`Stream error: ${err instanceof Error ? err.message : String(err)}`);
      setStatus("Error setting up stream");
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = () => {
    if (!streamRef.current || !isClient) return;

    audioChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = sendDataToBackend;

    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
    setIsRecording(true);
    setStatus("Recording...");
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatus("Processing speech...");
    }
  };

  const speakText = (text: string) => {
    if (!window.speechSynthesis) {
      setError("Speech synthesis not supported in this browser");
      console.error("SpeechSynthesis not supported");
      return;
    }

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      console.log("Available voices:", voices);
      const chineseVoice = voices.find((v) => v.lang === "zh-CN");
      if (!chineseVoice) {
        setError("No Chinese voice available on this device");
        console.error("No Chinese voice available");
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.voice = chineseVoice;
      utterance.onstart = () => console.log("Speech started");
      utterance.onend = () => console.log("Speech ended");
      utterance.onerror = (event) => {
        console.error("Speech error:", event.error);
        setError(`Speech error: ${event.error}`);
      };
      console.log("Speaking response:", text);
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      loadVoices();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        loadVoices();
        window.speechSynthesis.onvoiceschanged = null; // 防止重复绑定
      };
    }
  };

  const sendDataToBackend = async () => {
    if (!isClient) return;

    try {
      if (audioChunksRef.current.length === 0 || !videoRef.current) {
        return;
      }

      setIsProcessing(true);

      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);

        const imageBlob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((blob) => resolve(blob || new Blob([])), "image/jpeg");
        });

        const imageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(imageBlob);
        });

        const audioBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(audioBlob);
        });

        const timestamp = new Date().toISOString();

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
          setStatus("Request timed out. Ready for new speech.");
          setIsProcessing(false);
        }, 10000);

        console.log("Sending request to backend...");
        const response = await fetch("https://app.eyes.deeperai.net/api/v1/llm/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image: imageBase64,
            audio: audioBase64.split(",")[1],
            timestamp: timestamp,
          }),
        });

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        if (response.ok) {
          const data = await response.json();
          setStatus("Data processed. Ready for new speech.");
          console.log("Response received from backend", data);

          if (data.data.response) {
            speakText(data.data.response); // 使用优化后的播放函数
          }
        } else {
          throw new Error(`Server responded with ${response.status}`);
        }
      }
    } catch (err) {
      setError(`Upload error: ${err instanceof Error ? err.message : String(err)}`);
      setStatus("Error processing data. Ready for new speech.");
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleCamera = () => {
    const newFacingMode = facingMode === "user" ? "environment" : "user";
    setFacingMode(newFacingMode);
    console.log("Switching to:", newFacingMode);
    setupMediaStream();
  };

  useEffect(() => {
    if (isClient) {
      checkPermissions();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isClient]);

  useEffect(() => {
    if (hasPermissions) {
      setupMediaStream();
    }
  }, [facingMode]);

  if (!isClient) {
    return (
      <div className="container mx-auto py-10 max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Speech Capture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <span className="text-muted-foreground">Loading...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-10 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Speech Capture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="relative aspect-video bg-muted rounded-md overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {isRecording && (
              <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-md text-xs animate-pulse">
                Recording
              </div>
            )}
            {isProcessing && (
              <div className="absolute top-2 left-2 bg-blue-500 text-white px-2 py-1 rounded-md text-xs">
                Processing
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 text-sm">
            <div className={`w-3 h-3 rounded-full ${hasPermissions ? "bg-green-500" : "bg-red-500"}`}></div>
            <span className="text-muted-foreground">{status}</span>
          </div>

          <button
            onClick={toggleRecording}
            disabled={!hasPermissions || isProcessing}
            className={`w-full h-20 rounded-lg font-semibold text-white transition-colors ${
              isRecording
                ? "bg-red-500 hover:bg-red-600"
                : hasPermissions && !isProcessing
                ? "bg-blue-500 hover:bg-blue-600"
                : "bg-gray-300"
            }`}
          >
            {isRecording ? "Stop Recording" : "Start Recording"}
          </button>

          <button
            onClick={toggleCamera}
            disabled={!hasPermissions}
            className={`w-full py-2 rounded-lg font-semibold text-white transition-colors ${
              hasPermissions ? "bg-purple-500 hover:bg-purple-600" : "bg-gray-300"
            }`}
          >
            {facingMode === "user" ? "Switch to Back Camera" : "Switch to Front Camera"}
          </button>

          <div className="flex justify-center gap-4 text-muted-foreground">
            <div className="flex items-center gap-1">
              <Camera className="h-4 w-4" />
              <span className="text-xs">{hasPermissions ? "Active" : "Inactive"}</span>
            </div>
            <div className="flex items-center gap-1">
              <Mic className="h-4 w-4" />
              <span className="text-xs">{hasPermissions ? "Active" : "Inactive"}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}