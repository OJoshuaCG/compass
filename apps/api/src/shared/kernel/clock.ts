/** El tiempo entra por este puerto para que las pruebas sean deterministas. */
export interface Clock {
  now(): Date;
}
