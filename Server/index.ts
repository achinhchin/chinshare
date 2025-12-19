import { Elysia, file } from 'elysia';
import { cors } from '@elysiajs/cors';
import { join, resolve } from 'path';

const PORT = 1770;

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

type Room = {
    broadcaster: any;
    viewers: Map<string, any>; // id -> ws (wrapper or raw? let's store wrapper for sending convenience, but maybe raw is safer?)
    // Actually, storing wrapper in Map is fine IF we only use it for .send().
    // But wait, if wrapper is transient, can we .send() on it later?
    // Elysia docs say .send() is available on the context.
    // Let's store ws.raw to be safe for sending too? ws.raw.send() works in Bun.
};

const rooms = new Map<string, Room>();

// Use ws.raw as key because Elysia's `ws` object might be transient/wrapped differently per request
const sessionData = new WeakMap<any, { role?: string, roomId?: string, id?: string }>();

const generateRoomId = () => Math.floor(100000 + Math.random() * 900000).toString();

const handleMessage = (ws: any, message: any) => {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;
        // console.log('Msg:', data.type); // Debug

        switch (data.type) {
            case 'create-room': {
                let roomId = generateRoomId();
                while (rooms.has(roomId)) roomId = generateRoomId();

                rooms.set(roomId, {
                    broadcaster: ws,
                    viewers: new Map()
                });

                // Store session on RAW socket
                sessionData.set(ws.raw, { role: 'broadcaster', roomId });

                log(`Room created: ${roomId}`);
                ws.send({ type: 'room-created', roomId });
                break;
            }

            case 'join-room': {
                const { roomId } = data;
                const room = rooms.get(roomId);

                if (!room) {
                    ws.send({ type: 'error', message: 'Room not found' });
                    return;
                }

                const viewerId = Math.random().toString(36).substr(2, 9);

                room.viewers.set(viewerId, ws);

                // Store session on RAW socket
                sessionData.set(ws.raw, { role: 'viewer', roomId, id: viewerId });

                log(`Viewer ${viewerId} joined room ${roomId}`);
                ws.send({ type: 'joined-room', roomId, viewerId });

                if (room.broadcaster && room.broadcaster.raw.readyState === 1) {
                    room.broadcaster.send({ type: 'viewer-connect', id: viewerId });
                }
                break;
            }

            case 'offer': {
                const sData = sessionData.get(ws.raw);
                if (!sData?.roomId) {
                    console.warn('Offer rejected: No session data');
                    return;
                }

                const room = rooms.get(sData.roomId);
                if (room && data.to && room.viewers.has(data.to)) {
                    // console.log(`Forwarding offer to ${data.to}`);
                    room.viewers.get(data.to).send(data);
                }
                break;
            }

            case 'answer': {
                const sData = sessionData.get(ws.raw);
                if (!sData?.roomId) return;

                const room = rooms.get(sData.roomId);
                if (room) {
                    if (sData.role === 'viewer' && room.broadcaster) {
                        room.broadcaster.send(data);
                    } else if (sData.role === 'broadcaster' && data.to) {
                        if (room.viewers.has(data.to)) {
                            room.viewers.get(data.to).send(data);
                        }
                    }
                }
                break;
            }

            case 'candidate': {
                const sData = sessionData.get(ws.raw);
                if (!sData?.roomId) return;

                const room = rooms.get(sData.roomId);
                if (!room) return;

                if (sData.role === 'broadcaster') {
                    if (data.to && room.viewers.has(data.to)) {
                        room.viewers.get(data.to).send(data);
                    }
                } else {
                    if (room.broadcaster) {
                        room.broadcaster.send(data);
                    }
                }
                break;
            }
        }
    } catch (e) {
        console.error('Error processing message:', e);
    }
}

const handleClose = (ws: any) => {
    const sData = sessionData.get(ws.raw);
    if (!sData) return;

    const { role, roomId, id } = sData;

    // Clean up session data
    sessionData.delete(ws.raw);

    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'broadcaster') {
        log(`Broadcaster left room ${roomId}. Destroying room.`);
        for (const viewer of room.viewers.values()) {
            if (viewer.raw.readyState === 1) {
                viewer.send({ type: 'room-closed' });
            }
        }
        rooms.delete(roomId);
    } else {
        if (id && room.viewers.has(id)) {
            room.viewers.delete(id);
            log(`Viewer ${id} left room ${roomId}`);
            if (room.broadcaster && room.broadcaster.raw.readyState === 1) {
                room.broadcaster.send({ type: 'viewer-disconnect', id });
            }
        }
    }
}


const webappDir = resolve(join(import.meta.dir, '../webapp'));
const indexHtml = join(webappDir, 'index.html');
const styleCss = join(webappDir, 'style.css');
const scriptJs = join(webappDir, 'script.js');

console.log('Server root:', import.meta.dir);
console.log('Serving from:', webappDir);

const server = new Elysia()
    .use(cors({ origin: true }))
    .ws('/ws', {
        open(ws) { },
        message(ws, message) { handleMessage(ws, message) },
        close(ws) { handleClose(ws) }
    })
    // SECURE: Strict whitelist of allowed files
    .get('/style.css', () => file(styleCss))
    .get('/script.js', () => file(scriptJs))
    .get('/', () => file(indexHtml))
    // SECURE: Block everything else
    .all('*', (c) => {
        console.log('404 for:', c.path);
        return new Response('Not Found / Forbidden', { status: 404 });
    })
    .listen(PORT);

log(`Unified Server running at http://localhost:${PORT}`);
