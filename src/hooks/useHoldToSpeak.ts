import { useState, useRef, useCallback, useEffect } from 'react';

type HoldState = 'idle' | 'requesting' | 'recording' | 'stopped';

export function useHoldToSpeak(): {
  state: HoldState;
  audioBlob: Blob | null;
  waveformData: Uint8Array | null;
  start: () => Promise<void>;
  stop: () => void;
} {
  const [state, setState] = useState<HoldState>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [waveformData, setWaveformData] = useState<Uint8Array | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Mirror of `state` in a ref so start/stop callbacks read the latest value
  // without stale closure (rapid re-entry would see the prior render's state
  // through the React state closure, causing double-starts or missed stops).
  const stateRef = useRef<HoldState>('idle');

  const stopWaveformLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const startWaveformLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      setWaveformData(new Uint8Array(buffer));
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  // Unmount cleanup — tear down recorder, AudioContext, stream tracks, rAF.
  // Without this, an unmount mid-recording leaks the mic (LED stays on),
  // the AudioContext, and the waveform rAF loop.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* ignore */ }
      }
      mediaRecorderRef.current = null;
      audioContextRef.current?.close().catch(() => { /* ignore */ });
      audioContextRef.current = null;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const start = useCallback(async () => {
    // Idempotent: no-op if already requesting or recording.
    // Read stateRef (not `state`) to avoid stale closure on rapid re-entry.
    if (stateRef.current === 'requesting' || stateRef.current === 'recording') return;

    // Clear any prior blob so UI consumers don't see stale data during the
    // new recording (onstop will set the fresh blob).
    setAudioBlob(null);

    stateRef.current = 'requesting';
    setState('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      stateRef.current = 'idle';
      setState('idle');
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    // Set up AudioContext + AnalyserNode for waveform.
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyserRef.current = analyser;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    // Set up MediaRecorder.
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      setAudioBlob(blob);
      stateRef.current = 'stopped';
      setState('stopped');
      stopWaveformLoop();

      // Clean up tracks.
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };

    recorder.start();
    stateRef.current = 'recording';
    setState('recording');
    startWaveformLoop();
  }, [startWaveformLoop, stopWaveformLoop]);

  const stop = useCallback(() => {
    // No-op if not recording or already stopped.
    // Read stateRef (not `state`) to avoid stale closure on rapid re-entry.
    if (stateRef.current !== 'recording') return;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }

    // Close AudioContext.
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    stopWaveformLoop();
    // Note: stateRef + setState('stopped') and setAudioBlob happen in onstop callback.
  }, [stopWaveformLoop]);

  return { state, audioBlob, waveformData, start, stop };
}
