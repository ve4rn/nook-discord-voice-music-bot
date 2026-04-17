import { Event, EventBuilderOptions, EventName, ClientEvents } from './main.js';

export const EventBuilder = <T extends EventName>(
    options: EventBuilderOptions<T>,
    callback: (...args: ClientEvents[T]) => Promise<any>
): Event<T> => {
    return {
        options,
        execute: callback,
    };
};
