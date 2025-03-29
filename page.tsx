"use client"

import { useState, useRef, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Mic, Camera, AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function MediaCapturePage() {
  const [hasPermissions, setHasPermissions] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [status, setStatus] = useState("Initializing...")
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isClient, setIsClient] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Check if we're on the client side
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Request permissions and set up media streams
  const requestPermissions = async () => {
    if (!isClient) return

    try {
      setStatus("Requesting permissions...")
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      setHasPermissions(true)
      setStatus("Ready to detect speech")
      startSpeechDetection()
    } catch (err) {
      setError(`Permission error: ${err instanceof Error ? err.message : String(err)}`)
      setStatus("Permission denied")
    }
  }

  // Start speech detection
  const startSpeechDetection = () => {
    if (!streamRef.current || !isClient) return

    setStatus("Listening for speech...")

    // Set up audio context for speech detection
    const audioContext = new AudioContext()
    const audioSource = audioContext.createMediaStreamSource(streamRef.current)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.4
    audioSource.connect(analyser)

    const audioData = new Uint8Array(analyser.frequencyBinCount)

    // Function to detect if user is speaking based on audio levels
    const detectSpeech = () => {
      console.log("detectSpeech")
      if (!hasPermissions || !isClient) return

      analyser.getByteFrequencyData(audioData)

      // Calculate average volume
      const average = audioData.reduce((sum, value) => sum + value, 0) / audioData.length

      // If volume is above threshold, consider it as speaking
      const isSpeakingNow = average > 20 // Adjust threshold as needed

      if (isSpeakingNow !== isSpeaking) {
        setIsSpeaking(isSpeakingNow)

        if (isSpeakingNow && !isProcessing) {
          startRecording()
          setStatus("Speech detected! Recording...")
        } else if (!isSpeakingNow && mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
          stopRecording()
          setStatus("Processing speech...")
        }
      }

      // Continue detecting
      if (isClient) {
        requestAnimationFrame(detectSpeech)
      }
    }

    detectSpeech()
  }

  // Start recording audio
  const startRecording = () => {
    if (!streamRef.current || !isClient) return

    audioChunksRef.current = []
    const mediaRecorder = new MediaRecorder(streamRef.current)

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data)
      }
    }

    mediaRecorder.onstop = sendDataToBackend

    mediaRecorder.start()
    mediaRecorderRef.current = mediaRecorder
  }

  // Stop recording audio
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop()
    }
  }

  // Send captured data to backend
  const sendDataToBackend = async () => {
    if (!isClient) return

    try {
      if (audioChunksRef.current.length === 0 || !videoRef.current) {
        return
      }

      setIsProcessing(true)

      // Create audio blob
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })

      // Capture current image from video
      const canvas = document.createElement("canvas")
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const ctx = canvas.getContext("2d")

      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0)

        // Convert canvas to blob
        const imageBlob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob)
            else resolve(new Blob([]))
          }, "image/jpeg")
        })

        // Create form data with both audio and image
        const formData = new FormData()
        formData.append("audio", audioBlob, "recording.webm")
        formData.append("image", imageBlob, "capture.jpg")

        // Set timeout for 10 seconds
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }

        timeoutRef.current = setTimeout(() => {
          setStatus("Request timed out. Ready for new speech.")
          setIsProcessing(false)
        }, 10000)

        // Send to backend
        const response = await fetch("/api/media-upload", {
          method: "POST",
          body: formData,
        })

        // Clear timeout if response received
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }

        if (response.ok) {
          setStatus("Data processed. Ready for new speech.")
        } else {
          throw new Error(`Server responded with ${response.status}`)
        }
      }
    } catch (err) {
      setError(`Upload error: ${err instanceof Error ? err.message : String(err)}`)
      setStatus("Error processing data. Ready for new speech.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Initialize on component mount
  useEffect(() => {
    if (isClient) {
      requestPermissions()
    }

    // Clean up on unmount
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [isClient]) // Only run when isClient changes

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
    )
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
            {isSpeaking && (
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
  )
}

