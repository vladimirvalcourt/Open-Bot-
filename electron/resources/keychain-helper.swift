import Foundation
import Security

let service = "com.openmausbot.secrets"
guard CommandLine.arguments.count == 3 else { exit(64) }
let operation = CommandLine.arguments[1]
let account = CommandLine.arguments[2]
guard account.range(of: #"^[A-Za-z0-9._-]{1,220}$"#, options: .regularExpression) != nil else { exit(65) }

let base: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

switch operation {
case "get":
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { exit(status == errSecItemNotFound ? 1 : 70) }
    FileHandle.standardOutput.write(data)
case "set":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty, data.count <= 1_000_000 else { exit(65) }
    let attributes: [String: Any] = [kSecValueData as String: data]
    let update = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
    if update == errSecItemNotFound {
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { exit(70) }
    } else if update != errSecSuccess { exit(70) }
case "delete":
    let status = SecItemDelete(base as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { exit(70) }
default:
    exit(64)
}
