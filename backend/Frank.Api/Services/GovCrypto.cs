using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Frank.Api.Services;

// Kryptografia dla KSeF 2.0 i bramki JPK e-Dokumenty:
// - AES-256-CBC (PKCS#7) do szyfrowania dokumentów,
// - RSA (klucz publiczny MF) do owijania klucza symetrycznego i tokena KSeF,
// - skróty SHA-256 / MD5 wymagane przez obie bramki.
public static class GovCrypto
{
    public static byte[] RandomBytes(int n) => RandomNumberGenerator.GetBytes(n);

    public static (byte[] Cipher, byte[] Iv) Aes256CbcEncrypt(byte[] plain, byte[] key)
    {
        using var aes = Aes.Create();
        aes.KeySize = 256;
        aes.Key = key;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        aes.GenerateIV();
        using var enc = aes.CreateEncryptor();
        return (enc.TransformFinalBlock(plain, 0, plain.Length), aes.IV);
    }

    public static byte[] Aes256CbcDecrypt(byte[] cipher, byte[] key, byte[] iv)
    {
        using var aes = Aes.Create();
        aes.KeySize = 256;
        aes.Key = key;
        aes.IV = iv;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        using var dec = aes.CreateDecryptor();
        return dec.TransformFinalBlock(cipher, 0, cipher.Length);
    }

    public static byte[] Sha256(byte[] data) => SHA256.HashData(data);

    public static byte[] Md5(byte[] data) => MD5.HashData(data);

    public static string B64(byte[] data) => Convert.ToBase64String(data);

    public static byte[] FromB64(string b64) => Convert.FromBase64String(b64);

    /// RSA/ECB/PKCS#1 (bramka JPK) — szyfrowanie klucza AES certyfikatem MF.
    public static byte[] RsaPkcs1Encrypt(byte[] data, RSA rsa) =>
        rsa.Encrypt(data, RSAEncryptionPadding.Pkcs1);

    /// RSA-OAEP-SHA256 (KSeF 2.0) — token i klucz symetryczny.
    public static byte[] RsaOaepSha256Encrypt(byte[] data, RSA rsa) =>
        rsa.Encrypt(data, RSAEncryptionPadding.OaepSHA256);

    /// Klucz publiczny RSA z certyfikatu X.509 (PEM lub DER).
    public static RSA PublicRsaFromCertPem(string pemPath)
    {
        var cert = X509Certificate2.CreateFromPem(File.ReadAllText(pemPath));
        return cert.GetRSAPublicKey()
            ?? throw new InvalidOperationException($"Brak klucza RSA w {pemPath}.");
    }

    public static RSA PublicRsaFromCertDer(byte[] der)
    {
        var cert = System.Security.Cryptography.X509Certificates.X509CertificateLoader.LoadCertificate(der);
        return cert.GetRSAPublicKey()
            ?? throw new InvalidOperationException("Brak klucza RSA w certyfikacie DER.");
    }

    /// Klucz publiczny RSA z certyfikatu (DER Base64) zwracanego przez KSeF
    /// (GET /security/public-key-certificates).
    public static RSA PublicRsaFromCertB64(string derBase64) =>
        PublicRsaFromCertDer(FromB64(derBase64));
}
