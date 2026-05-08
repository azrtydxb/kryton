# packages/ui/src/editor/view/native/ios/KrytonEditor.podspec
Pod::Spec.new do |s|
  s.name         = "KrytonEditor"
  s.version      = "0.1.0"
  s.summary      = "Native iOS editor for Kryton (UITextView + RN bridge)"
  s.homepage     = "https://github.com/azrtydxb/kryton"
  s.license      = { :type => "MIT" }
  s.authors      = { "kryton" => "noreply@kryton.local" }
  s.platforms    = { :ios => "13.0" }
  s.source       = { :path => "." }
  s.source_files = "*.swift"
  s.dependency "React-Core"
  s.swift_version = "5.0"
end
