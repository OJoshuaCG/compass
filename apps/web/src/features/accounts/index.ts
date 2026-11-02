/** Fachada pública del feature `accounts`: la pantalla "Cuentas" de la bóveda (listado, inventario y altas, ediciones y archivado). */
export { AccountsPage } from './containers/accounts-page';
// Editar y archivar también se ofrecen desde el detalle de la cuenta (feature `credentials`).
export { ArchiveAccountDialog } from './containers/archive-account-dialog';
export { EditAccountDialog } from './containers/edit-account-dialog';
export { canArchiveAccount, canEditAccount } from './model/account-access';
