SwaggerUIBundle({
  url: "/openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis],
  supportedSubmitMethods: ["get", "put", "post", "delete"],
  persistAuthorization: false,
  validatorUrl: null,
});
