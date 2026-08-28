// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "FJGMailIntelligence",
  platforms: [.macOS(.v26)],
  products: [
    .executable(name: "fjg-mail-intelligence", targets: ["FJGMailIntelligence"])
  ],
  targets: [
    .executableTarget(name: "FJGMailIntelligence"),
    .testTarget(
      name: "FJGMailIntelligenceTests",
      dependencies: ["FJGMailIntelligence"]
    )
  ]
)
