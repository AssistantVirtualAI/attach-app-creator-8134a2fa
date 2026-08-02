require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'CapacitorPjsip'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://planipret.ca'
  s.author = 'Planipret'
  s.source = { :git => 'https://planipret.ca', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '14.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'

  # PJSIP binary integration (see docs/pjsip-ios-setup.md).
  # Uncomment once libpjsip.xcframework has been built and copied to ios/Frameworks/.
  # s.vendored_frameworks = 'ios/Frameworks/libpjsip.xcframework'
  # s.pod_target_xcconfig = { 'OTHER_SWIFT_FLAGS' => '-DPJSIP_AVAILABLE' }
end
