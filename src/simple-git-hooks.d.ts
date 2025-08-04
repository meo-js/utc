declare module "simple-git-hooks/simple-git-hooks.js" {
    /**
     * Check if simple-git-hooks is in dependencies
     * @param projectRootPath - Path to the project root
     * @returns Boolean indicating if simple-git-hooks is found in dependencies
     */
    export function checkSimpleGitHooksInDependencies(
        projectRootPath: string
    ): boolean;

    /**
     * Set hooks from configuration
     * @param projectRootPath - Path to the project root (defaults to process.cwd())
     * @param argv - Command line arguments (defaults to process.argv)
     */
    export function setHooksFromConfig(
        projectRootPath?: string,
        argv?: string[]
    ): Promise<void>;

    /**
     * Get project root directory from node_modules path
     * @param projectPath - Path to the project
     * @returns Project root path or undefined
     */
    export function getProjectRootDirectoryFromNodeModules(
        projectPath: string
    ): string | undefined;

    /**
     * Get git project root directory
     * @param directory - Directory to start search from (defaults to process.cwd())
     * @returns Git project root path or undefined
     */
    export function getGitProjectRoot(directory?: string): string | undefined;

    /**
     * Remove all git hooks
     * @param projectRoot - Path to the project root (defaults to process.cwd())
     */
    export function removeHooks(projectRoot?: string): Promise<void>;

    /**
     * Check if installation should be skipped based on environment variables
     * @returns Boolean indicating if installation should be skipped
     */
    export function skipInstall(): boolean;

    /**
     * Script prepended to all git hooks
     */
    export const PREPEND_SCRIPT: string;
}
