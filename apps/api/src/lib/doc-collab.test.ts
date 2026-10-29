import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { bufferEarlyMessages } from "./doc-collab";

function fakeSocket() {
  return Object.assign(new EventEmitter(), { binaryType: "nodebuffer" }) as unknown as WebSocket;
}

describe("bufferEarlyMessages", () => {
  // Regression: the client's SyncStep1 arrives while the WS handler is still
  // awaiting auth; without a listener already attached, `ws` drops it and
  // the doc never reaches "Synced".
  it("captures frames sent before the room is attached", () => {
    const socket = fakeSocket();
    const early = bufferEarlyMessages(socket);
    const syncStep1 = Buffer.from([0, 0, 1, 0]);

    socket.emit("message", syncStep1);

    expect(early.pending).toEqual([syncStep1]);
    expect(socket.binaryType).toBe("arraybuffer");
  });

  it("stops buffering once stopped, so frames aren't handled twice", () => {
    const socket = fakeSocket();
    const early = bufferEarlyMessages(socket);

    early.stop();
    socket.emit("message", Buffer.from([0, 0, 1, 0]));

    expect(early.pending).toEqual([]);
    expect(socket.listenerCount("message")).toBe(0);
  });
});
