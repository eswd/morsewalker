/**
 * Audio output for Vail Master
 * Simplified version of Vail Repeater's outputs.mjs - sidetone only
 */

import {AudioSource, AudioContextTime} from "./audio.mjs"
import * as time from "./time.mjs"

const DEFAULT_FREQ = 550  // Default sidetone frequency (Hz)

/** The amount of time it should take an oscillator to ramp to and from zero gain
 *
 * @constant {Duration}
 */
const OscillatorRampDuration = 5 * time.Millisecond


class Oscillator extends AudioSource {
    /**
     * Create a new oscillator, and encase it in a Gain for control.
     *
     * @param {AudioContext} context Audio context
     * @param {number} frequency Oscillator frequency (Hz)
     * @param {number} maxGain Maximum gain (volume) of this oscillator (0.0 - 1.0)
     * @param {string} type Oscillator type
     */
    constructor(context, frequency, maxGain = 0.5, type = "sine") {
        super(context)
        this.maxGain = maxGain

        // Start quiet
        this.masterGain.gain.value = 0

        this.osc = new OscillatorNode(this.context)
        this.osc.type = type
        this.osc.connect(this.masterGain)
        this.setFrequency(frequency)
        this.osc.start()
    }

    /**
     * Set oscillator frequency
     *
     * @param {Number} frequency New frequency (Hz)
     */
    setFrequency(frequency) {
        this.osc.frequency.value = frequency
    }

    /**
     * Set gain to some value at a given time.
     *
     * @param {number} target Target gain
     * @param {Date} when Time this should start
     * @param {Duration} timeConstant Duration of ramp to target gain
     */
    async setTargetAtTime(target, when, timeConstant = OscillatorRampDuration) {
        await this.context.resume()
        this.masterGain.gain.setTargetAtTime(
            target,
            AudioContextTime(this.context, when),
            timeConstant / time.Second,
        )
    }

    /**
     * Make sound at a given time.
     *
     * @param {Number} when When to start making noise
     * @param {Number} timeConstant How long to ramp up
     * @returns {Promise}
     */
    SoundAt(when = 0, timeConstant = OscillatorRampDuration) {
        return this.setTargetAtTime(this.maxGain, when, timeConstant)
    }

    /**
     * Shut up at a given time.
     *
     * @param {Number} when When to stop making noise
     * @param {Number} timeConstant How long to ramp down
     * @returns {Promise}
     */
    HushAt(when = 0, timeConstant = OscillatorRampDuration) {
        return this.setTargetAtTime(0, when, timeConstant)
    }
}


/**
 * Simple sidetone buzzer for practice
 */
class SidetoneBuzzer extends AudioSource {
    constructor(context, frequency = DEFAULT_FREQ, maxGain = 0.5) {
        super(context)

        this.osc = new Oscillator(this.context, frequency, maxGain)
        this.osc.connect(this.masterGain)
    }

    /**
     * Set sidetone frequency
     *
     * @param {Number} frequency Frequency in Hz
     */
    SetFrequency(frequency) {
        this.osc.setFrequency(frequency)
    }

    /**
     * Begin buzzing
     *
     * @param {number} when Time to begin, in ms (0=now)
     */
    async Buzz(when = 0) {
        this.osc.SoundAt(when)
    }

    /**
     * Stop buzzing
     *
     * @param {number} when Time to end, in ms (0=now)
     */
    async Silence(when = 0) {
        this.osc.HushAt(when)
    }

    /**
     * Buzz for a duration
     *
     * @param {number} when Time to begin, in ms (0=now)
     * @param {number} duration Duration of buzz (ms)
     */
    BuzzDuration(when, duration) {
        this.Buzz(when)
        this.Silence(when + duration)
    }
}


/**
 * Optional feedback sounds (success/error)
 */
class FeedbackSounds extends AudioSource {
    constructor(context, maxGain = 0.3) {
        super(context)
        this.maxGain = maxGain

        // Success: two-tone ascending
        this.successOsc1 = new Oscillator(this.context, 523, maxGain) // C5
        this.successOsc2 = new Oscillator(this.context, 659, maxGain) // E5

        // Error: descending
        this.errorOsc = new Oscillator(this.context, 220, maxGain) // A3

        this.successOsc1.connect(this.masterGain)
        this.successOsc2.connect(this.masterGain)
        this.errorOsc.connect(this.masterGain)
    }

    /**
     * Play success sound
     */
    async PlaySuccess() {
        const now = Date.now()
        this.successOsc1.SoundAt(now)
        this.successOsc1.HushAt(now + 100 * time.Millisecond)
        this.successOsc2.SoundAt(now + 100 * time.Millisecond)
        this.successOsc2.HushAt(now + 200 * time.Millisecond)
    }

    /**
     * Play error sound
     */
    async PlayError() {
        const now = Date.now()
        this.errorOsc.SoundAt(now)
        this.errorOsc.HushAt(now + 200 * time.Millisecond)
    }
}


/**
 * Audio output collection for Vail Master
 */
class AudioOutput extends AudioSource {
    /**
     * @param {AudioContext} context Audio Context
     * @param {Object} options Configuration options
     */
    constructor(context, options = {}) {
        super(context)

        const {
            frequency = DEFAULT_FREQ,
            volume = 0.5,
            feedbackEnabled = true
        } = options

        // Main sidetone
        this.sidetone = new SidetoneBuzzer(this.context, frequency, volume)
        this.sidetone.connect(this.masterGain)

        // Feedback sounds (optional)
        this.feedback = new FeedbackSounds(this.context, volume * 0.6)
        this.feedback.connect(this.masterGain)
        this.feedbackEnabled = feedbackEnabled

        // Connect to destination
        this.masterGain.connect(this.context.destination)
    }

    /**
     * Set the sidetone frequency
     *
     * @param {number} frequency Frequency in Hz
     */
    SetFrequency(frequency) {
        this.sidetone.SetFrequency(frequency)
    }

    /**
     * Set the master volume
     *
     * @param {number} volume Volume (0.0 - 1.0)
     */
    SetVolume(volume) {
        this.masterGain.gain.value = volume
    }

    /**
     * Enable/disable feedback sounds
     *
     * @param {boolean} enabled True to enable feedback sounds
     */
    SetFeedbackEnabled(enabled) {
        this.feedbackEnabled = enabled
    }

    /**
     * Begin sidetone
     *
     * @param {number} when Time to begin (0=now)
     */
    Buzz(when = 0) {
        this.sidetone.Buzz(when)
    }

    /**
     * End sidetone
     *
     * @param {number} when Time to end (0=now)
     */
    Silence(when = 0) {
        this.sidetone.Silence(when)
    }

    /**
     * Buzz for a duration
     *
     * @param {number} when Time to begin
     * @param {number} duration Duration in ms
     */
    BuzzDuration(when, duration) {
        this.sidetone.BuzzDuration(when, duration)
    }

    /**
     * Stop all sounds immediately
     */
    Panic() {
        this.Silence()
    }

    /**
     * Play success feedback
     */
    PlaySuccess() {
        if (this.feedbackEnabled) {
            this.feedback.PlaySuccess()
        }
    }

    /**
     * Play error feedback
     */
    PlayError() {
        if (this.feedbackEnabled) {
            this.feedback.PlayError()
        }
    }
}

export { AudioOutput, DEFAULT_FREQ }
