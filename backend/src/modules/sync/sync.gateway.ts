import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { SyncService } from './sync.service';
import { AwarenessService } from './awareness.service';
import { IndexerService } from '../search/indexer.service';
import { PrismaService } from '../../prisma.service';

// AFFiNE protocol: response wrapper
type WsResponse<T> = { data: T } | { error: { name: string; message: string } };

function ok<T>(data: T): WsResponse<T> {
  return { data };
}

function err(name: string, message: string): WsResponse<never> {
  return { error: { name, message } };
}

// Room naming convention matching AFFiNE server
function syncRoom(spaceType: string, spaceId: string): string {
  return `${spaceType}:${spaceId}:sync`;
}

function syncRoom026(spaceType: string, spaceId: string): string {
  return `${spaceType}:${spaceId}:sync-026`;
}

function awarenessRoom(
  spaceType: string,
  spaceId: string,
  docId: string,
): string {
  return `${spaceType}:${spaceId}:${docId}:awareness`;
}

interface ConnectionState {
  userId?: string;
  spaces: Set<string>; // joined "spaceType:spaceId" keys
  awarenessDocs: Set<string>; // joined "spaceType:spaceId:docId" keys
}

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  // AFFiNE frontend uses root namespace '/'
  namespace: '/',
  transports: ['polling', 'websocket'],
  pingInterval: 15000,
  pingTimeout: 10000,
})
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SyncGateway.name);
  private connections = new Map<string, ConnectionState>();
  private _restoreMode = false;

  /** Enter restore mode: disconnect all clients and reject new connections/pushes */
  async enterRestoreMode(): Promise<void> {
    this._restoreMode = true;
    this.logger.log('Entering restore mode — disconnecting all clients');
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      socket.disconnect(true);
    }
  }

  /** Exit restore mode: allow connections again */
  exitRestoreMode(): void {
    this._restoreMode = false;
    this.logger.log('Exiting restore mode — accepting connections');
  }

  constructor(
    private syncService: SyncService,
    private awarenessService: AwarenessService,
    private jwtService: JwtService,
    private indexerService: IndexerService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    // Reject connections during restore
    if (this._restoreMode) {
      this.logger.log(`Rejecting connection ${client.id} — restore in progress`);
      client.disconnect(true);
      return;
    }

    try {
      const token =
        client.handshake.auth?.token ||
        this.parseCookie(client.handshake.headers.cookie, 'affine_token');

      let userId: string | undefined;
      if (token) {
        try {
          const payload = this.jwtService.verify(token);
          userId = payload.sub;
        } catch {
          // Anonymous connection allowed for public docs
        }
      }

      this.connections.set(client.id, {
        userId,
        spaces: new Set(),
        awarenessDocs: new Set(),
      });
      this.logger.log(
        `Client connected: ${client.id} (user: ${userId || 'anonymous'})`,
      );
    } catch (e) {
      this.logger.error(`Connection error: ${e}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const conn = this.connections.get(client.id);
    if (conn) {
      // Clean up awareness rooms
      for (const key of conn.awarenessDocs) {
        const room = key + ':awareness';
        this.awarenessService.leaveBySocketId(client.id);
      }
    }
    this.connections.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ─── space:join ──────────────────────────────────────────────
  @SubscribeMessage('space:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; clientVersion?: string },
  ): Promise<WsResponse<{ clientId: string }>> {
    const conn = this.connections.get(client.id);
    if (!conn) return err('INTERNAL', 'Connection not found');

    const { spaceType, spaceId } = data;
    const key = `${spaceType}:${spaceId}`;

    // Verify workspace exists (guard against stale IndexedDB data)
    if (spaceType === 'workspace') {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: spaceId },
        select: { id: true },
      });
      if (!ws) {
        this.logger.warn(
          `space:join rejected — workspace ${spaceId} not found (stale client data)`,
        );
        return err('WORKSPACE_NOT_FOUND', `Workspace ${spaceId} not found`);
      }
    }

    // Join rooms
    client.join(syncRoom(spaceType, spaceId));
    client.join(syncRoom026(spaceType, spaceId));
    conn.spaces.add(key);

    this.logger.log(`Client ${client.id} joined ${key}`);
    return ok({ clientId: client.id });
  }

  // ─── space:leave ─────────────────────────────────────────────
  @SubscribeMessage('space:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { spaceType: string; spaceId: string },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    const { spaceType, spaceId } = data;
    const key = `${spaceType}:${spaceId}`;

    client.leave(syncRoom(spaceType, spaceId));
    client.leave(syncRoom026(spaceType, spaceId));
    conn.spaces.delete(key);
  }

  // ─── space:load-doc ──────────────────────────────────────────
  @SubscribeMessage('space:load-doc')
  async handleLoadDoc(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      stateVector?: string;
    },
  ): Promise<
    WsResponse<{ missing: string; state: string; timestamp: number }>
  > {
    this.logger.log(
      `space:load-doc from ${client.id}: spaceType=${data.spaceType} spaceId=${data.spaceId} docId=${data.docId} hasStateVector=${!!data.stateVector}`,
    );
    try {
      let stateVector: Uint8Array | undefined;
      if (data.stateVector) {
        stateVector = Buffer.from(data.stateVector, 'base64');
      }

      const result = await this.syncService.loadDoc(
        data.spaceId,
        data.docId,
        stateVector,
      );

      this.logger.log(
        `space:load-doc response for ${data.docId}: missing=${result.missing.length}bytes state=${result.state.length}bytes`,
      );

      return ok({
        missing: Buffer.from(result.missing).toString('base64'),
        state: Buffer.from(result.state).toString('base64'),
        timestamp: result.timestamp,
      });
    } catch (e: any) {
      this.logger.error(`space:load-doc error for ${data.docId}: ${e.message}`);
      return err('DOC_NOT_FOUND', e.message || 'Document not found');
    }
  }

  // ─── space:push-doc-update ───────────────────────────────────
  @SubscribeMessage('space:push-doc-update')
  async handlePushDocUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      update: string;
    },
  ): Promise<WsResponse<{ timestamp: number }>> {
    // Reject pushes during restore to prevent stale cache from overwriting restored data
    if (this._restoreMode) {
      return err('RESTORE_IN_PROGRESS', 'System is being restored');
    }

    const conn = this.connections.get(client.id);
    if (!conn)
      return err('INTERNAL', 'Connection not found');

    this.logger.log(
      `space:push-doc-update from ${client.id}: docId=${data.docId} updateSize=${data.update.length}chars`,
    );

    try {
      const update = Buffer.from(data.update, 'base64');
      const { spaceType, spaceId, docId } = data;

      const timestamp = await this.syncService.pushUpdate(
        spaceId,
        docId,
        update,
        conn.userId,
      );

      // Broadcast to sync-026 room (batched format)
      client
        .to(syncRoom026(spaceType, spaceId))
        .emit('space:broadcast-doc-updates', {
          spaceType,
          spaceId,
          docId,
          updates: [data.update],
          timestamp,
          editor: conn.userId,
        });

      // Broadcast to legacy sync room (single update format)
      client
        .to(syncRoom(spaceType, spaceId))
        .emit('space:broadcast-doc-update', {
          spaceType,
          spaceId,
          docId,
          update: data.update,
          timestamp,
          editor: conn.userId,
        });

      // Schedule search index update (debounced)
      this.indexerService.scheduleIndex(spaceId, docId);

      return ok({ timestamp });
    } catch (e: any) {
      return err('PUSH_FAILED', e.message || 'Failed to push update');
    }
  }

  // ─── space:load-doc-timestamps ───────────────────────────────
  @SubscribeMessage('space:load-doc-timestamps')
  async handleLoadDocTimestamps(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; timestamp?: number },
  ): Promise<WsResponse<Record<string, number>>> {
    this.logger.log(
      `space:load-doc-timestamps from ${client.id}: spaceId=${data.spaceId} after=${data.timestamp ?? 'none'}`,
    );
    try {
      const timestamps = await this.syncService.getDocTimestamps(
        data.spaceId,
        data.timestamp,
      );
      this.logger.log(
        `space:load-doc-timestamps response: ${Object.keys(timestamps).length} docs`,
      );
      return ok(timestamps);
    } catch (e: any) {
      this.logger.error(`space:load-doc-timestamps error: ${e.message}`);
      return err('LOAD_TIMESTAMPS_FAILED', e.message);
    }
  }

  // ─── space:delete-doc ────────────────────────────────────────
  @SubscribeMessage('space:delete-doc')
  async handleDeleteDoc(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; docId: string },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    await this.syncService.deleteDoc(data.spaceId, data.docId);
  }

  // ─── space:join-awareness ────────────────────────────────────
  @SubscribeMessage('space:join-awareness')
  async handleJoinAwareness(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      clientVersion?: string;
    },
  ): Promise<WsResponse<{ clientId: string }>> {
    const conn = this.connections.get(client.id);
    if (!conn) return err('INTERNAL', 'Connection not found');

    const { spaceType, spaceId, docId } = data;
    const room = awarenessRoom(spaceType, spaceId, docId);
    const key = `${spaceType}:${spaceId}:${docId}`;

    client.join(room);
    conn.awarenessDocs.add(key);
    this.awarenessService.join(room, client.id, conn.userId);

    return ok({ clientId: client.id });
  }

  // ─── space:leave-awareness ───────────────────────────────────
  @SubscribeMessage('space:leave-awareness')
  async handleLeaveAwareness(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; docId: string },
  ) {
    const conn = this.connections.get(client.id);
    if (!conn) return;

    const { spaceType, spaceId, docId } = data;
    const room = awarenessRoom(spaceType, spaceId, docId);
    const key = `${spaceType}:${spaceId}:${docId}`;

    client.leave(room);
    conn.awarenessDocs.delete(key);
    this.awarenessService.leave(room, client.id);
  }

  // ─── space:update-awareness ──────────────────────────────────
  @SubscribeMessage('space:update-awareness')
  async handleUpdateAwareness(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      spaceType: string;
      spaceId: string;
      docId: string;
      awarenessUpdate: string;
    },
  ) {
    const { spaceType, spaceId, docId, awarenessUpdate } = data;
    const room = awarenessRoom(spaceType, spaceId, docId);

    // Broadcast to all other clients in the awareness room
    client.to(room).emit('space:broadcast-awareness-update', {
      spaceType,
      spaceId,
      docId,
      awarenessUpdate,
    });
  }

  // ─── space:load-awarenesses ──────────────────────────────────
  @SubscribeMessage('space:load-awarenesses')
  async handleLoadAwarenesses(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { spaceType: string; spaceId: string; docId: string },
  ) {
    const { spaceType, spaceId, docId } = data;
    const room = awarenessRoom(spaceType, spaceId, docId);

    // Ask all other clients in the room to re-broadcast their awareness
    client.to(room).emit('space:collect-awareness', {
      spaceType,
      spaceId,
      docId,
    });
  }

  private parseCookie(
    cookieHeader: string | undefined,
    name: string,
  ): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
    return match?.[1] ?? null;
  }
}
