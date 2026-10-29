# StrategyLocal

Start with [the step-by-step Mac setup](deploy/local/README.md), then [the account and MyAgent workflow](docs/local-workspace.md).

For an existing installation, use [update and verify](deploy/local/README.md#update-an-existing-installation). Start researching an empty account with [the new account intake request](docs/local-workspace.md#new-account-intake-request): prepare a combined Salesforce and web prompt, download Markdown or ZIP, give it to MyAgent, then import and review its response.

Browser access now uses the Compose-managed web gateway. Existing users of the temporary helper must follow [the gateway migration](deploy/local/README.md#migrate-the-temporary-gateway) to free port 3000 before starting the new service.

The implementation is published on the `main` branch. No Bedrock, AWS, or MyAgent API credentials are required. External AI remains disabled by default.

[Optional exchange-folder and local-model setup](docs/local-model-setup.md) is separate from the base installation. Follow its checks before enabling an option. Native Apple inference, Keychain, and Docker Desktop-to-Mac connectivity have not been verified on a physical Mac. See [validation evidence](deploy/local/VALIDATION.md).
