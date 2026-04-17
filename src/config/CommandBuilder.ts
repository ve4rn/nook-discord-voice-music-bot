import { CommandBuilderOptions, ExecuteFunction, Command, AutoCompleteFunction } from './main.js'
export const CommandBuilder = (
    options: CommandBuilderOptions,
    callback: ExecuteFunction,
    autocomplete?: AutoCompleteFunction
): Command => {
    return {
        options,
        execute: callback,
        autocomplete
    };
};


