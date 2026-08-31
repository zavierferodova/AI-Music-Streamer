import { ServerStatus } from "@/types";
import { postApiFallback } from "./api";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
export type StatusListener = (status: ServerStatus) => void;
export type ConnectionListener = (state: ConnectionState, message?: string) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private statusListeners: Set<StatusListener> = new Set();
  private connectionListeners: Set<ConnectionListener> = new Set();
  private currentState: ConnectionState = "disconnected";
  private isIntentionallyClosed = false;

  public connect() {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isIntentionallyClosed = false;
    this.setConnectionState("connecting", "Connecting to Stream Server...");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host || "localhost:8000";
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.setConnectionState("connected", "Connected (Realtime WS)");
      };

      this.ws.onmessage = (event) => {
        try {
          const data: ServerStatus = JSON.parse(event.data);
          this.notifyStatus(data);
        } catch (err) {
          console.error("[WebSocket] Parse error:", err);
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (!this.isIntentionallyClosed) {
          this.setConnectionState("reconnecting", "Connection lost. Reconnecting in 1.5s...");
          this.scheduleReconnect();
        } else {
          this.setConnectionState("disconnected", "Disconnected");
        }
      };

      this.ws.onerror = (err) => {
        console.warn("[WebSocket] Error:", err);
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch (err) {
      console.error("[WebSocket] Connection exception:", err);
      this.setConnectionState("reconnecting", "Connection failed. Retrying...");
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    this.isIntentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState("disconnected", "Disconnected");
  }

  public sendCommand(payload: Record<string, any>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      // Fallback to REST API
      const action = payload.action || "";
      postApiFallback(action, payload);
    }
  }

  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.currentState);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  public getConnectionState(): ConnectionState {
    return this.currentState;
  }

  private setConnectionState(state: ConnectionState, message?: string) {
    this.currentState = state;
    this.connectionListeners.forEach((l) => l(state, message));
  }

  private notifyStatus(status: ServerStatus) {
    this.statusListeners.forEach((l) => l(status));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1500);
  }
}

export const wsClient = new WebSocketClient();
