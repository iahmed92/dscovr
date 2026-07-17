import { createAudioPlayer, setAudioModeAsync, useAudioPlayerStatus } from 'expo-audio';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { resolvePreview } from '@/lib/vibecheck';

type NowPlayingState = {
  activeArtistId: number | null;
  isPlaying: boolean;
  loadingArtistId: number | null;
  errorArtistId: number | null;
  toggle: (artistId: number) => void;
};

const NowPlayingContext = createContext<NowPlayingState | null>(null);

export function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  // A single shared player, created once and never auto-released, so
  // starting a new preview naturally stops whatever was playing before —
  // there's only ever one audio source loaded across the whole app.
  const player = useMemo(() => createAudioPlayer(null), []);
  const status = useAudioPlayerStatus(player);

  const [activeArtistId, setActiveArtistId] = useState<number | null>(null);
  const [loadingArtistId, setLoadingArtistId] = useState<number | null>(null);
  const [errorArtistId, setErrorArtistId] = useState<number | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
    return () => player.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(artistId: number) {
    if (activeArtistId === artistId) {
      status.playing ? player.pause() : player.play();
      return;
    }

    setErrorArtistId(null);
    setLoadingArtistId(artistId);

    try {
      const result = await resolvePreview(artistId);

      if (!result.preview_url) {
        setErrorArtistId(artistId);
        setLoadingArtistId(null);
        return;
      }

      player.replace({ uri: result.preview_url });
      player.play();
      setActiveArtistId(artistId);
    } catch {
      setErrorArtistId(artistId);
    } finally {
      setLoadingArtistId(null);
    }
  }

  const value: NowPlayingState = {
    activeArtistId,
    isPlaying: status.playing,
    loadingArtistId,
    errorArtistId,
    toggle,
  };

  return <NowPlayingContext.Provider value={value}>{children}</NowPlayingContext.Provider>;
}

export function useNowPlaying() {
  const ctx = useContext(NowPlayingContext);
  if (!ctx) throw new Error('useNowPlaying must be used within a NowPlayingProvider');
  return ctx;
}
