import { Injectable } from '@nestjs/common';

export interface AwarenessEntry {
  socketId: string;
  userId?: string;
}

@Injectable()
export class AwarenessService {
  // room -> Map<socketId, AwarenessEntry>
  private rooms = new Map<string, Map<string, AwarenessEntry>>();
  // socketId -> Set<room>  (for cleanup on disconnect)
  private socketRooms = new Map<string, Set<string>>();

  join(room: string, socketId: string, userId?: string) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Map());
    }
    this.rooms.get(room)!.set(socketId, { socketId, userId });

    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    this.socketRooms.get(socketId)!.add(room);
  }

  leave(room: string, socketId: string) {
    this.rooms.get(room)?.delete(socketId);
    if (this.rooms.get(room)?.size === 0) {
      this.rooms.delete(room);
    }
    this.socketRooms.get(socketId)?.delete(room);
  }

  leaveBySocketId(socketId: string) {
    const rooms = this.socketRooms.get(socketId);
    if (rooms) {
      for (const room of rooms) {
        this.rooms.get(room)?.delete(socketId);
        if (this.rooms.get(room)?.size === 0) {
          this.rooms.delete(room);
        }
      }
    }
    this.socketRooms.delete(socketId);
  }

  getMembers(room: string): AwarenessEntry[] {
    const entries = this.rooms.get(room);
    return entries ? Array.from(entries.values()) : [];
  }
}
