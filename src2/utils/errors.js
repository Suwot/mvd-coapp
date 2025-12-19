import { logDebug } from './utils';

export class CoAppError extends Error {
    constructor(message, key, originalError = null) {
        super(message);
        this.name = 'CoAppError';
        this.key = key;
        this.originalError = originalError;
    }
}

const ERROR_MAP = {
    'ENOENT': 'fileNotFound',
    'EACCES': 'directoryNotWritable',
    'EPERM': 'directoryNotWritable',
    'EROFS': 'directoryNotWritable',
    'ENOTDIR': 'folderNotFound',
    'ELOOP': 'folderNotFound',
    'ENOSPC': 'diskFull'
};

export function wrapError(err, defaultKey = 'internalError') {
    if (err instanceof CoAppError) return err;
    
    const key = ERROR_MAP[err.code] || defaultKey;
    return new CoAppError(err.message, key, err);
}

export function fail(message, key) {
    throw new CoAppError(message, key);
}
