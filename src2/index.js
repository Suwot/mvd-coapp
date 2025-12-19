#!/usr/bin/env node
import { IS_MACOS, IS_LINUX, ALLOWED_IDS, KNOWN_COMMANDS } from './utils/config';
import { logStartup } from './utils/utils';
import { initializeMessaging } from './core/router';
import { handleDoubleClick, handleCliArgs, showUsage } from './core/installer_cli';

logStartup();

const args = process.argv.slice(2);
const isStdinTTY = !!process.stdin.isTTY;

(async () => {
    // 1. Install (0 arguments on Mac/Linux)
    if (args.length === 0) {
        if (IS_MACOS || IS_LINUX) return handleDoubleClick();
        process.exit(0);
    }

    // 2. CLI (Known flags)
    if (KNOWN_COMMANDS.includes(args[0])) {
        return handleCliArgs(args);
    }

    // 3. Native Messaging (Broad ID check)
    const isMessaging = args.some(arg => ALLOWED_IDS.some(id => arg.includes(id)));
    if (isMessaging && !isStdinTTY) {
        return initializeMessaging();
    }

    // 4. Reject everything else
    if (isStdinTTY) showUsage();
    process.exit(1);
})().catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
});
