import { PackageList, type PackageName } from './yarn';

export const PackageToDistribution = new Map<
  PackageName,
  BUILD_CONFIG_TYPE['distribution']
>([
  ['@ofuro/admin', 'admin'],
  ['@ofuro/web', 'web'],
  ['@ofuro/electron-renderer', 'desktop'],
  ['@ofuro/electron', 'desktop'],
  ['@ofuro/mobile', 'mobile'],
  ['@ofuro/ios', 'ios'],
  ['@ofuro/android', 'android'],
]);

export const AliasToPackage = new Map<string, PackageName>([
  ['admin', '@ofuro/admin'],
  ['web', '@ofuro/web'],
  ['electron', '@ofuro/electron'],
  ['desktop', '@ofuro/electron-renderer'],
  ['renderer', '@ofuro/electron-renderer'],
  ['mobile', '@ofuro/mobile'],
  ['ios', '@ofuro/ios'],
  ['android', '@ofuro/android'],
  ['server', '@ofuro/server'],
  ['gql', '@ofuro/graphql'],
  ...PackageList.map(
    pkg => [pkg.name.split('/').pop()!, pkg.name] as [string, PackageName]
  ),
]);
