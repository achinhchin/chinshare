import { Elysia, file } from 'elysia';
import { cors } from '@elysiajs/cors';
import { join, resolve } from 'path';
import { mkdirSync, existsSync, unlinkSync, readdirSync, statSync, rmSync, createReadStream } from 'fs';

const PORT = 8000;
const UPLOAD_DIR = resolve(join(import.meta.dir, '../uploads'));
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

type Room = {
    broadcaster: any;
    viewers: Map<string, any>;
    fileMode: boolean;
    fileName?: string;
};

const rooms = new Map<string, Room>();

const sessionData = new WeakMap<any, { role?: string, roomId?: string, id?: string }>();

const generateRoomId = () => Math.floor(100000 + Math.random() * 900000).toString();

// Clean up uploaded file for a room
function cleanupRoomFiles(roomId: string) {
    const roomDir = join(UPLOAD_DIR, roomId);
    if (existsSync(roomDir)) {
        try {
            rmSync(roomDir, { recursive: true, force: true });
            log(`Cleaned up files for room ${roomId}`);
        } catch (e) {
            console.error(`Failed to clean up room ${roomId} files:`, e);
        }
    }
}

const handleMessage = (ws: any, message: any) => {
    try {
        const data = typeof message === 'string' ? JSON.parse(message) : message;

        switch (data.type) {
            case 'create-room': {
                let { roomId } = data;

                if (roomId) {
                    const room = rooms.get(roomId);
                    if (room) {
                        if (room.broadcaster && room.broadcaster.raw.readyState === 1) {
                            ws.send({ type: 'error', message: 'Room already has a broadcaster' });
                            return;
                        }

                        room.broadcaster = ws;
                        sessionData.set(ws.raw, { role: 'broadcaster', roomId });
                        log(`Broadcaster reclaimed room: ${roomId}`);
                        ws.send({ type: 'room-created', roomId });

                        room.viewers.forEach((viewer, viewerId) => {
                            if (viewer.raw.readyState === 1) {
                                ws.send({ type: 'viewer-connect', id: viewerId });
                            }
                        });
                        return;
                    }
                }

                roomId = roomId || generateRoomId();
                while (rooms.has(roomId)) roomId = generateRoomId();

                rooms.set(roomId, {
                    broadcaster: ws,
                    viewers: new Map(),
                    fileMode: false
                });

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

                sessionData.set(ws.raw, { role: 'viewer', roomId, id: viewerId });

                log(`Viewer ${viewerId} joined room ${roomId}`);
                ws.send({ type: 'joined-room', roomId, viewerId });

                if (room.broadcaster && room.broadcaster.raw.readyState === 1) {
                    room.broadcaster.send({ type: 'viewer-connect', id: viewerId });
                }
                break;
            }

            // --- File mode messages: Broadcaster -> Viewers ---
            case 'file-mode-start': {
                const sData = sessionData.get(ws.raw);
                if (!sData?.roomId || sData.role !== 'broadcaster') return;

                const room = rooms.get(sData.roomId);
                if (!room) return;

                room.fileMode = true;
                room.fileName = data.fileName;

                // Forward to all viewers
                room.viewers.forEach((viewer) => {
                    if (viewer.raw.readyState === 1) {
                        viewer.send({
                            type: 'file-mode-start',
                            fileUrl: data.fileUrl
                        });
                    }
                });
                log(`Room ${sData.roomId}: File mode started - ${data.fileName}`);
                break;
            }

            case 'file-play':
            case 'file-pause':
            case 'file-seek':
            case 'file-sync': {
                const sData = sessionData.get(ws.raw);
                if (!sData?.roomId || sData.role !== 'broadcaster') return;

                const room = rooms.get(sData.roomId);
                if (!room) return;

                // Forward to all viewers
                room.viewers.forEach((viewer) => {
                    if (viewer.raw.readyState === 1) {
                        viewer.send(data);
                    }
                });
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

    sessionData.delete(ws.raw);

    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'broadcaster') {
        log(`Broadcaster disconnected from room ${roomId}.`);
        room.broadcaster = null;

        for (const viewer of room.viewers.values()) {
            if (viewer.raw.readyState === 1) {
                viewer.send({ type: 'broadcaster-disconnected' });
            }
        }

        if (room.viewers.size === 0) {
            log(`Room ${roomId} empty. Destroying.`);
            cleanupRoomFiles(roomId);
            rooms.delete(roomId);
        }
    } else {
        if (id && room.viewers.has(id)) {
            room.viewers.delete(id);
            log(`Viewer ${id} left room ${roomId}`);
            if (room.broadcaster && room.broadcaster.raw.readyState === 1) {
                room.broadcaster.send({ type: 'viewer-disconnect', id });
            }

            if (!room.broadcaster && room.viewers.size === 0) {
                log(`Room ${roomId} empty. Destroying.`);
                cleanupRoomFiles(roomId);
                rooms.delete(roomId);
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
    // File upload endpoint
    .post('/upload/:roomId', async (c) => {
        const roomId = c.params.roomId;
        const room = rooms.get(roomId);

        if (!room) {
            return new Response('Room not found', { status: 404 });
        }

        // Get the uploaded file from the request body
        const formData = await c.request.formData();
        const uploadedFile = formData.get('file') as File | null;

        if (!uploadedFile) {
            return new Response('No file provided', { status: 400 });
        }

        if (uploadedFile.size > MAX_FILE_SIZE) {
            return new Response('File too large (max 500MB)', { status: 413 });
        }

        // Create room directory
        const roomDir = join(UPLOAD_DIR, roomId);
        if (!existsSync(roomDir)) {
            mkdirSync(roomDir, { recursive: true });
        }

        // Clean previous uploads for this room
        try {
            const existing = readdirSync(roomDir);
            for (const f of existing) {
                unlinkSync(join(roomDir, f));
            }
        } catch (e) { }

        // Save file
        const safeName = uploadedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = join(roomDir, safeName);
        const arrayBuffer = await uploadedFile.arrayBuffer();
        await Bun.write(filePath, arrayBuffer);

        log(`File uploaded for room ${roomId}: ${safeName} (${(uploadedFile.size / 1024 / 1024).toFixed(1)}MB)`);

        const fileUrl = `/media/${roomId}/${safeName}`;
        return Response.json({ success: true, fileUrl, fileName: safeName });
    })
    // Media serving endpoint with Range support for seeking
    .get('/media/:roomId/:fileName', (c) => {
        const { roomId, fileName } = c.params;

        // Security: sanitize filename
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = join(UPLOAD_DIR, roomId, safeName);

        if (!existsSync(filePath)) {
            return new Response('File not found', { status: 404 });
        }

        const stat = statSync(filePath);
        const fileSize = stat.size;

        // Determine MIME type
        const ext = safeName.split('.').pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mkv': 'video/x-matroska',
            'avi': 'video/x-msvideo',
            'mov': 'video/quicktime'
        };
        const contentType = mimeTypes[ext || ''] || 'application/octet-stream';

        // Handle Range requests for seeking
        const rangeHeader = c.request.headers.get('range');

        if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            const bunFile = Bun.file(filePath);
            const slice = bunFile.slice(start, end + 1);

            return new Response(slice, {
                status: 206,
                headers: {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize.toString(),
                    'Content-Type': contentType,
                    'Cache-Control': 'no-store',
                }
            });
        }

        // Full file response
        return new Response(Bun.file(filePath), {
            headers: {
                'Content-Length': fileSize.toString(),
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-store',
            }
        });
    })
    // Serve webapp files
    .get('/style.css', () => file(styleCss))
    .get('/script.js', () => file(scriptJs))
    .get('/', () => file(indexHtml))
    // Block everything else
    .all('*', (c) => {
        console.log('404 for:', c.path);
        return new Response('Not Found / Forbidden', { status: 404 });
    })
    .listen(PORT);

log(`Unified Server running at http://localhost:${PORT}`);
