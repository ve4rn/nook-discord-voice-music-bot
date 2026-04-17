import { 
    BitFieldResolvable, 
    PermissionFlagsBits, 
    ChatInputCommandInteraction, 
    ClientEvents, 
    AutocompleteInteraction
 } from 'discord.js';
import type { LocalizationMap } from 'discord.js';
import App  from './App.js';
type Permissions = BitFieldResolvable<keyof typeof PermissionFlagsBits, bigint>;
type CommandCategory =
  | 'Permissions'
  | 'Embeds'
  | 'Templates'
  | 'Badges'
  | 'Diagnostics'
  | 'Miscellaneous'
  | 'Private';

type CommandVisibility = 'public' | 'private';

type CommandLocalizationMap = LocalizationMap;

interface LocalizedText {
  name_localizations?: CommandLocalizationMap;
  description_localizations?: CommandLocalizationMap;
  localizations?: {
    name?: CommandLocalizationMap;
    description?: CommandLocalizationMap;
  };
}

interface Choice {
  name: string;
  value: string | number;
  name_localizations?: CommandLocalizationMap;
  localizations?: {
    name?: CommandLocalizationMap;
  };
}

type ArgTypePrimitive =
  | 'Attachment'
  | 'User'
  | 'Channel'
  | 'Role'
  | 'Mentionable'
  | 'Boolean';

type ArgTypeValue =
  | 'String'
  | 'Integer'
  | 'Number';

interface BaseArg extends LocalizedText {
  name: string;
  description: string;
  required?: boolean;
}

interface AutocompleteArg extends BaseArg {
  type: ArgTypeValue;
  autocomplete: true;
  choices?: never;
}

interface ChoiceArg extends BaseArg {
  type: ArgTypeValue;
  choices: Choice[];
  autocomplete?: false;
}

interface SimpleArg extends BaseArg {
  type: ArgTypePrimitive;
  autocomplete?: never;
  choices?: never;
}

interface NeutralTypedArg extends BaseArg {
  type: ArgTypeValue;
  autocomplete?: undefined;
  choices?: undefined;
}

type LeafArg = AutocompleteArg | ChoiceArg | SimpleArg | NeutralTypedArg;

interface SubcommandArg extends BaseArg {
  type: 'Subcommand';
  args?: LeafArg[];
}

interface SubcommandGroupArg extends BaseArg {
  type: 'SubcommandGroup';
  args: SubcommandArg[];
}

type Arg = LeafArg | SubcommandArg | SubcommandGroupArg;

interface SlashCommandBuilderOptions extends LocalizedText {
  name: string;
  type?: CommandCategory;
  description: string;
  cooldown?: number;
  permissions: Permissions[];
  args?: Arg[];
}

type CommandBuilderOptions = SlashCommandBuilderOptions;
type AutoCompleteFunction = (
  interaction: AutocompleteInteraction,
  app: App
) => Promise<unknown | void>;
type ExecuteFunction = (
  interaction: ChatInputCommandInteraction,
  app: App
) => Promise<unknown | void>;

interface Command {
  options: CommandBuilderOptions;
  execute: ExecuteFunction;
  autocomplete?: AutoCompleteFunction;
  visibility?: CommandVisibility;
  category?: string;
}


type EventName = keyof ClientEvents;

interface EventBuilderOptions<T extends EventName> {
    name: T;
    description: string;
}

interface Event<T extends EventName> {
    options: EventBuilderOptions<T>;
    execute: (...args: ClientEvents[T]) => Promise<void>;
}

enum Intents {
    'Guilds' = 1 << 0,
    'GuildMembers' = 1 << 1,
    'GuildModeration' = 1 << 2,
    'GuildEmojisAndStickers' = 1 << 3,
    'GuildIntegrations' = 1 << 4,
    'GuildWebhooks' = 1 << 5,
    'GuildInvites' = 1 << 6,
    'GuildVoiceStates' = 1 << 7,
    'GuildPresences' = 1 << 8,
    'GuildMessages' = 1 << 9,
    'GuildMessageReactions' = 1 << 10,
    'GuildMessageTyping' = 1 << 11,
    'DirectMessages' = 1 << 12,
    'DirectMessageReactions' = 1 << 13,
    'DirectMessageTyping' = 1 << 14,
    'MessageContent' = 1 << 15,
    'GuildScheduledEvents'  = 1 << 16,
    'AutoModerationConfiguration' = 1 << 20,
    'AutoModerationExecution' = 1 << 21,
    'All' = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512  | 1024 | 2048 | 4096 | 8192 | 16384 | 32768 | 65536 | 1048576 | 2097152
}

export { 
  ExecuteFunction, 
  Command, 
  SlashCommandBuilderOptions, 
  CommandBuilderOptions, 
  EventBuilderOptions, 
  Event, 
  EventName, 
  ClientEvents, 
  Arg, 
  Intents, 
  CommandCategory, 
  CommandVisibility,
  CommandLocalizationMap,
  LocalizedText,
  Choice,
  AutoCompleteFunction, 
  LeafArg,
  SubcommandGroupArg,
  SubcommandArg
 };
