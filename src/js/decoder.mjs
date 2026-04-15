/**
 * Morse Code Decoder for Vail Master
 *
 * This module wraps the morse-pro adaptive decoder library to provide
 * live decoding of morse code from user input.
 *
 * Based on Vail Repeater's decoder, adapted for practice trainer use.
 */

import MorseAdaptiveDecoder from './morse-pro-decoder-adaptive.mjs'

/**
 * VailDecoder manages morse code decoding for practice sessions.
 * It handles timing input and outputs decoded text.
 */
export class VailDecoder {
    /**
     * @param {Function} textCallback - Called when text is decoded: (text) => {}
     * @param {number} initialWPM - Initial WPM estimate (default: 20)
     * @param {number} bufferSize - Adaptive buffer size (default: 20, lower = faster)
     * @param {number} flushTimeout - Timeout in ms before flushing pending chars (default: 1000)
     */
    constructor(textCallback, initialWPM = 20, bufferSize = 20, flushTimeout = 600) {
        this.textCallback = textCallback
        this.enabled = true
        this.lastToneEndTime = 0  // Track when last tone ended (for calculating spaces)
        this.flushTimer = null  // Timer to flush pending characters
        this.fullText = ""  // Accumulate all decoded text
        this.bufferSize = bufferSize
        this.flushTimeout = flushTimeout

        // Create the adaptive decoder
        this.decoder = new MorseAdaptiveDecoder(
            initialWPM,  // Initial WPM guess
            initialWPM,  // Farnsworth WPM (same as regular for now)
            bufferSize,  // Buffer size for adaptive algorithm
            (message) => this.handleDecodedMessage(message),
            (speed) => this.handleSpeedUpdate(speed)
        )

        this.currentSpeed = { wpm: initialWPM, fwpm: initialWPM }
    }

    /**
     * Process a key down/up event pair as a tone duration
     * @param {number} duration - Duration of the tone in milliseconds
     * @param {number} timestamp - Timestamp when the tone started
     */
    addTone(duration, timestamp = Date.now()) {
        if (!this.enabled || duration <= 0) {
            return
        }

        // Calculate space since last tone (if this isn't the first tone)
        if (this.lastToneEndTime > 0 && timestamp > this.lastToneEndTime) {
            const spaceBeforeTone = timestamp - this.lastToneEndTime
            this.decoder.addTiming(-spaceBeforeTone)  // Negative = silence
        }

        // Add the tone duration (positive = tone)
        this.decoder.addTiming(duration)

        // Update last tone end time
        this.lastToneEndTime = timestamp + duration

        // Set a timer to flush pending characters after a pause
        this.resetFlushTimer()
    }

    /**
     * Process morse code timing from a Duration array (Vail Repeater format)
     * @param {Array<number>} durations - Array of tone ON/OFF durations in milliseconds
     * @param {number} timestamp - Timestamp of the transmission start
     */
    addDurations(durations, timestamp = Date.now()) {
        if (!this.enabled || !durations || durations.length === 0) {
            return
        }

        // Calculate space since last tone (if this isn't the first tone)
        if (this.lastToneEndTime > 0 && timestamp > this.lastToneEndTime) {
            const spaceBeforeTone = timestamp - this.lastToneEndTime
            this.decoder.addTiming(-spaceBeforeTone)  // Negative = silence
        }

        // Process the Duration array
        // In Vail's protocol, Duration alternates: [tone_on, space, tone_on, space, ...]
        // But often it's just a single tone: [duration]
        let currentTime = timestamp
        let isOn = true

        for (let duration of durations) {
            if (duration > 0) {
                const timing = isOn ? duration : -duration
                this.decoder.addTiming(timing)
                currentTime += duration
            }
            isOn = !isOn
        }

        // Update last tone end time
        this.lastToneEndTime = currentTime

        // Set a timer to flush pending characters
        this.resetFlushTimer()
    }

    /**
     * Reset the flush timer
     * @private
     */
    resetFlushTimer() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
        }
        // Flush after configured timeout of silence
        this.flushTimer = setTimeout(() => {
            this.flush()
        }, this.flushTimeout)
    }

    /**
     * Update buffer size (requires decoder recreation)
     * @param {number} bufferSize - New buffer size
     */
    setBufferSize(bufferSize) {
        this.bufferSize = bufferSize
        // Recreate decoder with new buffer size
        const wpm = this.currentSpeed.wpm
        this.decoder = new MorseAdaptiveDecoder(
            wpm,
            wpm,
            bufferSize,
            (message) => this.handleDecodedMessage(message),
            (speed) => this.handleSpeedUpdate(speed)
        )
    }

    /**
     * Update flush timeout
     * @param {number} timeout - New flush timeout in ms
     */
    setFlushTimeout(timeout) {
        this.flushTimeout = timeout
    }

    /**
     * Called by morse-pro when text is decoded
     * @private
     */
    handleDecodedMessage(message) {
        // morse-pro returns message.message (not message.text!)
        const text = message.message || message.text
        if (text) {
            this.fullText += text
            if (this.textCallback) {
                this.textCallback(text)
            }
        }
    }

    /**
     * Called by morse-pro when speed estimate changes
     * @private
     */
    handleSpeedUpdate(speed) {
        this.currentSpeed = speed
    }

    /**
     * Get the full decoded text accumulated so far
     * @returns {string}
     */
    getFullText() {
        return this.fullText
    }

    /**
     * Get current estimated speed
     * @returns {{wpm: number, fwpm: number}}
     */
    getSpeed() {
        return this.currentSpeed
    }

    /**
     * Enable or disable decoding
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled
    }

    /**
     * Flush any pending decoded characters
     */
    flush() {
        if (this.decoder && this.decoder.flush) {
            this.decoder.flush()
        }
    }

    /**
     * Clear all accumulated text and reset decoder state
     */
    clear() {
        this.fullText = ""
        this.lastToneEndTime = 0
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }
        this.reset()
    }

    /**
     * Reset the decoder state (but keep accumulated text)
     */
    reset() {
        // Recreate the decoder to reset all state
        const wpm = this.currentSpeed.wpm
        this.decoder = new MorseAdaptiveDecoder(
            wpm,
            wpm,
            this.bufferSize,
            (message) => this.handleDecodedMessage(message),
            (speed) => this.handleSpeedUpdate(speed)
        )
        this.lastToneEndTime = 0
    }

    /**
     * Set the initial WPM for the decoder
     * @param {number} wpm - Words per minute
     */
    setWPM(wpm) {
        this.decoder.wpm = wpm
        this.decoder.fwpm = wpm
        this.currentSpeed = { wpm, fwpm: wpm }
    }
}
