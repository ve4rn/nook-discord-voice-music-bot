import { CommandBuilderOptions, ExecuteFunction, Command, AutoCompleteFunction } from './main.js'
import { AutocompleteInteraction } from 'discord.js';
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


