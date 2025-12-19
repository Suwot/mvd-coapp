import { logDebug } from '../utils/utils';

/**
 * Protocol – Raw frame reading and writing for Native Messaging
 */
export class Protocol {
    constructor(onMessage, onPipeClosed) {
        this.buffer = Buffer.alloc(0);
        this.onMessage = onMessage;
        this.onPipeClosed = onPipeClosed;
        this.pipeClosed = false;

        process.stdin.on('data', this.handleData.bind(this));
        process.stdin.on('error', (err) => {
            logDebug(`[Protocol] STDIN ERROR: ${err.code} - ${err.message}`);
            process.exit(1);
        });
        
        process.stdout.on('error', (err) => {
            if (this.pipeClosed) return;
            this.pipeClosed = true;
            if (err.code === 'EPIPE') {
                logDebug('[Protocol] SIGPIPE: stdout closed - entering silent mode');
                if (this.onPipeClosed) this.onPipeClosed();
            }
        });

        process.stdin.on('end', () => {
            if (this.pipeClosed) return;
            this.pipeClosed = true;
            logDebug('[Protocol] STDIN ended - entering silent mode');
            if (this.onPipeClosed) this.onPipeClosed();
        });
    }

    handleData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.parse();
    }

    parse() {
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32LE(0);
            if (this.buffer.length < length + 4) break;

            const payload = this.buffer.subarray(4, length + 4);
            this.buffer = this.buffer.subarray(length + 4);

            try {
                const message = JSON.parse(payload.toString('utf8'));
                if (this.onMessage) this.onMessage(message);
            } catch (err) {
                logDebug('[Protocol] Parse Error:', err.message);
            }
        }
    }

    send(message, requestId = null) {
        if (this.pipeClosed) return;

        try {
            const payload = requestId ? { ...message, id: requestId } : message;
            const body = Buffer.from(JSON.stringify(payload), 'utf8');
            const header = Buffer.alloc(4);
            header.writeUInt32LE(body.length, 0);

            process.stdout.write(Buffer.concat([header, body]));
        } catch (err) {
            logDebug('[Protocol] Send Error:', err.message);
        }
    }
}
