/**
 * Turns a Zod schema into middleware. A request that fails validation never
 * reaches a service or a model.
 *
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.validatedParams = schemas.params.parse(req.params);
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
      next();
    } catch (err) {
      next(err); // ZodError is shaped by the error handler
    }
  };
}
