declare module 'ovenlivekit' {
  export interface OvenLiveKitCallbacks {
    connected?: (event: any) => void;
    connectionClosed?: (type: 'websocket' | 'ice' | 'user' | string, event: any) => void;
    iceStateChange?: (state: RTCIceConnectionState | string) => void;
    error?: (error: any) => void;
  }

  export interface OvenLiveKitOptions {
    callbacks?: OvenLiveKitCallbacks;
  }

  export interface OvenLiveKitConnectionConfig {
    iceServers?: RTCIceServer[];
    iceTransportPolicy?: RTCIceTransportPolicy;
    maxVideoBitrate?: number;
    preferredVideoFormat?: string;
    sdp?: {
      appendFmtp?: string;
    };
    simulcast?: any[];
    httpHeaders?: Record<string, string>;
  }

  export interface OvenLiveKitInstance {
    streamingMode: 'webrtc' | 'whip' | null;
    inputStream: MediaStream | null;
    videoElement: HTMLVideoElement | null;
    peerConnection: RTCPeerConnection | null;
    webSocket: WebSocket | null;
    callbacks: OvenLiveKitCallbacks;

    attachMedia(videoElement: HTMLVideoElement): void;
    getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
    getDisplayMedia(constraints?: DisplayMediaStreamOptions): Promise<MediaStream>;
    setMediaStream(stream: MediaStream): Promise<MediaStream>;
    startStreaming(endpointUrl: string, connectionConfig?: OvenLiveKitConnectionConfig): void;
    stopStreaming(): Promise<void>;
    remove(): void;
  }

  export interface OvenLiveKitStatic {
    create(options?: OvenLiveKitOptions): OvenLiveKitInstance;
    getDevices(type?: 'both' | 'video' | 'audio'): Promise<any>;
    getVersion(): string;
  }

  const OvenLiveKit: OvenLiveKitStatic;
  export default OvenLiveKit;
}
