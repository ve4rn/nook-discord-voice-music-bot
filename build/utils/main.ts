import {
  CommandBuilderOptions,
  LeafArg,
  SubcommandGroupArg,
  SubcommandArg,
  CommandLocalizationMap
} from '../config/main.js'
import ConsoleMessage from '../config/ConsoleMessage.js';
import {
  SlashCommandBuilder,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  APIApplicationCommandOptionChoice,
  PermissionsBitField,
  BitFieldResolvable,
  SlashCommandSubcommandBuilder,
} from 'discord.js';

type LocalizedConfig = {
  name_localizations?: CommandLocalizationMap;
  description_localizations?: CommandLocalizationMap;
  localizations?: {
    name?: CommandLocalizationMap;
    description?: CommandLocalizationMap;
  };
};

type ChoiceLocalizationConfig = {
  name_localizations?: CommandLocalizationMap;
  localizations?: {
    name?: CommandLocalizationMap;
  };
};

type LocalizableBuilder = {
  setNameLocalizations?: (localizations: CommandLocalizationMap | null) => unknown;
  setDescriptionLocalizations?: (localizations: CommandLocalizationMap | null) => unknown;
};

function hasLocalizationEntries(localizations?: CommandLocalizationMap): localizations is CommandLocalizationMap {
  return Boolean(localizations && Object.keys(localizations).length > 0);
}

function getLocalizedNameMap(config?: ChoiceLocalizationConfig): CommandLocalizationMap | undefined {
  return config?.name_localizations ?? config?.localizations?.name;
}

function getLocalizedDescriptionMap(config?: LocalizedConfig): CommandLocalizationMap | undefined {
  return config?.description_localizations ?? config?.localizations?.description;
}

function applyDisplayLocalizations<T extends LocalizableBuilder>(builder: T, config: LocalizedConfig): T {
  const localizedNames = getLocalizedNameMap(config);
  const localizedDescriptions = getLocalizedDescriptionMap(config);

  if (hasLocalizationEntries(localizedNames) && typeof builder.setNameLocalizations === 'function') {
    builder.setNameLocalizations(localizedNames);
  }

  if (hasLocalizationEntries(localizedDescriptions) && typeof builder.setDescriptionLocalizations === 'function') {
    builder.setDescriptionLocalizations(localizedDescriptions);
  }

  return builder;
}

function buildLocalizedChoice<T extends string | number>(
  choice: { name: string; value: string | number } & ChoiceLocalizationConfig,
  value: T
): APIApplicationCommandOptionChoice<T> {
  const localizedNames = getLocalizedNameMap(choice);
  return hasLocalizationEntries(localizedNames)
    ? { name: choice.name, value, name_localizations: localizedNames }
    : { name: choice.name, value };
}

function applyOptionBasics<T extends LocalizableBuilder>(
  option: T & {
    setName: (name: string) => T;
    setDescription: (description: string) => T;
    setRequired: (required: boolean) => T;
  },
  arg: LeafArg,
  required: boolean
): T {
  option.setName(arg.name);
  option.setDescription(arg.description);
  option.setRequired(required);
  return applyDisplayLocalizations(option, arg);
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function buildCommand(
  options: CommandBuilderOptions
): Promise<RESTPostAPIChatInputApplicationCommandsJSONBody> {

  const requiredProps: { key: keyof CommandBuilderOptions; type: string }[] = [
    { key: 'name', type: 'string' },
    { key: 'description', type: 'string' },
  ];
  requiredProps.forEach(({ key, type }) => {
    if (!(key in options)) {
      new ConsoleMessage('Warn', `Property '${key}' is missing.`);
    } else if (typeof options[key] !== type) {
      new ConsoleMessage(
        'Warn',
        `Property '${key}' must be of type '${type}'. (Received: ${typeof options[
        key
        ]})`
      );
    }
  });

  if (options.permissions?.length) {
    try {
      new PermissionsBitField(options.permissions as BitFieldResolvable<
        any,
        bigint
      >[]);
    } catch {
      new ConsoleMessage('Warn', "Property 'permissions' is invalid.");
    }
  }

  if ('cooldown' in options && typeof options.cooldown !== 'number') {
    new ConsoleMessage(
      'Warn',
      `Property 'cooldown' must be of type 'number'. (Received: ${typeof options.cooldown})`
    );
  }

  options.args?.forEach((arg, i) => {
    ['name', 'description'].forEach((prop) => {
      if (!(prop in arg)) {
        new ConsoleMessage(
          'Warn',
          `Property 'args[${i}].${prop}' is missing.`
        );
      } else if (typeof (arg as any)[prop] !== 'string') {
        new ConsoleMessage(
          'Warn',
          `Property 'args[${i}].${prop}' must be a string.`
        );
      }
    });

    if ('choices' in arg && Array.isArray(arg.choices)) {
      arg.choices.forEach((ch, j) => {
        if (typeof ch.name !== 'string') {
          new ConsoleMessage(
            'Warn',
            `Property 'args[${i}].choices[${j}].name' must be a string.`
          );
        }
        if (
          typeof ch.value !== 'string' &&
          typeof ch.value !== 'number'
        ) {
          new ConsoleMessage(
            'Warn',
            `Property 'args[${i}].choices[${j}].value' must be string or number.`
          );
        }
      });
    }
  });

  const builder = new SlashCommandBuilder()
    .setName(options.name)
    .setDescription(options.description);
  applyDisplayLocalizations(builder, options);

  if (options.permissions?.length) {
    const raw = PermissionsBitField.resolve(
      options.permissions as BitFieldResolvable<any, bigint>[]
    );
    builder.setDefaultMemberPermissions(raw.toString());
  }
  function applyLeafOption<
    T extends SlashCommandBuilder | SlashCommandSubcommandBuilder
  >(
    b: T,
    arg: LeafArg
  ): T {
    const required = arg.required ?? false;
    switch (arg.type) {
      case 'String':
        return b.addStringOption((opt: any) => {
          applyOptionBasics(opt, arg, required);
          if ('autocomplete' in arg && arg.autocomplete) {
            opt.setAutocomplete(true);
          } else if ('choices' in arg && arg.choices) {
            opt.addChoices(...arg.choices.map(c => buildLocalizedChoice(c, String(c.value))));
          }
          return opt;
        }) as T;

      case 'Integer':
        return b.addIntegerOption((opt: any) => {
          applyOptionBasics(opt, arg, required);
          if ('autocomplete' in arg && arg.autocomplete) {
            opt.setAutocomplete(true);
          } else if ('choices' in arg && arg.choices) {
            opt.addChoices(...arg.choices.map(c => buildLocalizedChoice(c, Number(c.value))));
          }
          return opt;
        }) as T;

      case 'Number':
        return b.addNumberOption((opt: any) => {
          applyOptionBasics(opt, arg, required);
          if ('autocomplete' in arg && arg.autocomplete) {
            opt.setAutocomplete(true);
          } else if ('choices' in arg && arg.choices) {
            opt.addChoices(...arg.choices.map(c => buildLocalizedChoice(c, Number(c.value))));
          }
          return opt;
        }) as T;

      case 'Boolean':
        return b.addBooleanOption((opt: any) =>
          applyOptionBasics(opt, arg, required)
        ) as T;

      case 'User':
        return b.addUserOption((opt: any) =>
          applyOptionBasics(opt, arg, required)
        ) as T;

      case 'Channel':
        return b.addChannelOption((opt: any) =>
          applyOptionBasics(opt, arg, required)
        ) as T;

      case 'Role':
        return b.addRoleOption((opt: any) =>
          applyOptionBasics(opt, arg, required)
        ) as T;

      case 'Mentionable':
        return b.addMentionableOption((opt: any) =>
          applyOptionBasics(opt, arg, required)
        ) as T;

      case 'Attachment':
        return b.addAttachmentOption((opt: any) =>
          applyOptionBasics(opt, arg, required)
        ) as T;

      default:
        return b;
    }
  }

  options.args?.forEach((arg) => {
    if ((arg as SubcommandGroupArg).type === 'SubcommandGroup') {
      const grp = arg as SubcommandGroupArg;
      builder.addSubcommandGroup((group) => {
        group.setName(grp.name).setDescription(grp.description);
        applyDisplayLocalizations(group, grp);
        grp.args.forEach((sub: SubcommandArg) => {
          group.addSubcommand((subBuilder) => {
            subBuilder
              .setName(sub.name)
              .setDescription(sub.description);
            applyDisplayLocalizations(subBuilder, sub);
            sub.args?.forEach((leaf: LeafArg) => applyLeafOption(subBuilder, leaf));
            return subBuilder;
          });
        });
        return group;
      });
    } else if ((arg as SubcommandArg).type === 'Subcommand') {
      const sub = arg as SubcommandArg;
      builder.addSubcommand((subBuilder) => {
        subBuilder
          .setName(sub.name)
          .setDescription(sub.description);
        applyDisplayLocalizations(subBuilder, sub);
        sub.args?.forEach((leaf: LeafArg) => applyLeafOption(subBuilder, leaf));
        return subBuilder;
      });
    } else {
      applyLeafOption(builder, arg as LeafArg);
    }
  });

  return builder.toJSON();
}

export function cleanText(text: string): string {
  text = text.replace(/[\u2018\u2019\u201C\u201D\u2014\u2013\u2026]/g, (m) => {
    switch (m) {
      case '\u2018':
      case '\u2019':
        return "'";
      case '\u201C':
      case '\u201D':
        return '"';
      case '\u2014':
      case '\u2013':
        return '-';
      case '\u2026':
        return '...';
      default:
        return m;
    }
  });

  text = text.replace(/[\u200B\u200C\u200D]/g, '');
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
};
