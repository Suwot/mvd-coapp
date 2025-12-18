/**
 * BaseCommand – Foundation class for all CoApp commands
 * - Provides common structure for all command implementations
 * - Manages messaging between CoApp and extension
 * - Offers standardized success/error/progress response methods
 * - Handles service access and dependency injection
 * - Enforces consistent command execution pattern
 */

/**
 * Base class for all commands
 */
class BaseCommand {
    constructor(messagingService) {
        this.messaging = messagingService;
        this.currentMessageId = null;
    }
    
    /**
     * Set the current message ID for responses
     */
    setMessageId(messageId) {
        this.currentMessageId = messageId;
    }

    /**
     * Send a message (response or event) back to the extension
     * @param {Object} message - The message to send
     * @param {Object} options - Optional parameters
     * @param {boolean} options.useMessageId - Whether to include the current message ID (default: true for responses)
     */
    sendMessage(message, options = {}) {
        const { useMessageId = true } = options;
        
        // For responses, include the message ID; for events, don't
        const messageId = useMessageId ? this.currentMessageId : null;
        
        this.messaging.sendMessage(message, messageId);
    }
    
    /**
     * Execute the command with the given parameters
     * To be implemented by subclasses
     */
    async execute(params) {
        throw new Error('Command execution not implemented');
    }
}

module.exports = BaseCommand;
