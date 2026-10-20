/** Conteúdo do arquivo em base64, sem o prefixo "data:...;base64,". */
export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error(`Não consegui abrir ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
