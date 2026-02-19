import { useState, useEffect, useRef } from "react";

export function useActiveUsers() {
  const [count, setCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectDelay = useRef(1000);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => {
        setIsConnected(true);
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "active-users") {
            setCount(data.count);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (!unmounted) {
          timer = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000);
            connect();
          }, reconnectDelay.current);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { count, isConnected };
}
