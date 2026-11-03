/**
 * Fachada pública del feature `shares`: con quién se comparte una cuenta de la bóveda (listado, alta y
 * revocación). También expone el formulario y la tabla de comparticiones para otros recursos que se
 * comparten con las mismas reglas (las vistas de códigos entrantes).
 */
export { SharesPage, type SharesPageProps } from './containers/shares-page';
export {
  ShareWithPersonForm,
  type ShareWithPersonFormProps,
} from './containers/share-with-person-form';
export { SharesTable, type ShareRow, type SharesTableProps } from './ui/shares-table';
