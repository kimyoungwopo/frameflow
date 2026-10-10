import catalog from '../../shared/command-catalog.json';

export type CommandCategory = {
  readonly id: string;
  readonly label: string;
  readonly commands: readonly { readonly code: string; readonly label: string; readonly use: string }[];
};

export const COMMAND_CATEGORIES: readonly CommandCategory[] = catalog.categories;
export const COMMAND_CATALOG_ID = catalog.id;
