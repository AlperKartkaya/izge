import re
"""A bounded, typed work plan; tool output can never grant new permissions."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class MCPRead(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connector_id: str = Field(min_length=1, max_length=80)
    tool_name: str = Field(min_length=1, max_length=100)
    arguments: dict = Field(default_factory=dict)


class AgentPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent: Literal["capabilities", "general", "company"]
    summary: str = Field(min_length=1, max_length=220)
    web_query: str = Field(max_length=300)
    mcp_reads: list[MCPRead] = Field(max_length=2)
    reviewer: bool


def non_substantive_reply(text: str, *, language: str) -> str | None:
    text = re.sub(r"^\s*@[iİı]zge\b\s*", "", text, flags=re.IGNORECASE)
    if any(character.isalnum() for character in text):
        return None
    return "How can I help you?" if language == "en" else "Size nasıl yardımcı olabilirim?"


def capabilities_text(*, web_enabled: bool, mcp_tools: list[dict]) -> str:
    return (
        "GERÇEK YETENEKLER VE SINIRLAR: Şirket dosyalarını, sohbet eklerini, günlükleri, açık görevleri ve risk sinyallerini "
        "yalnız konuşmadaki tüm katılımcıların erişim yetkileriyle okuyabilirim. "
        "Kaynaklı yanıt, potansiyel faturalanmamış işler, unutulan talepler, müşteri riski, ihale eksikleri, tekrar eden olaylar "
        "ve bekleyen onaylar hakkında öneri ve taslak üretebilirim. Günlük değerlendirme ve yapılandırılmış otomasyonlar worker tarafından yürütülür. "
        "Bağımsız bir denetçi model çağrısı kaynaklara dayalı taslağı kontrol edebilir; bu aynı seçili modelin ayrı görevidir, ayrı bir çalışan değildir. "
        + ("Web araması bu istekte izinli ve yapılandırılmıştır. " if web_enabled else "Web araması bu istekte kapalı veya yapılandırılmamıştır; internette arama yaptığımı söylemem. ")
        + ("Yetkili MCP okuma araçları: " + ", ".join(f"{tool['connector_id']}/{tool['name']}" for tool in mcp_tools) + ". " if mcp_tools else "Bu konuşmaya yetkili şirket MCP aracı bağlanmamıştır. ")
        + "Dosya sistemi üzerinde serbest dolaşma, kaynak dosyayı değiştirme, ticket kapatma, mailbox okuma, e-posta gönderme, fatura kesme "
        "ve dış sistemlere yazma aracı yoktur. Bunları gerçekleştirdiğimi iddia etmem; gerekli adımı kullanıcıya öneririm. "
        "Erişimim olmayan şirket verisini biliyormuş gibi davranmam. Ham iç düşünce yerine kısa işlem özeti ve kanıt sunarım."
    )


def capabilities_reply(*, web_enabled: bool, mcp_tools: list[dict], language: str) -> str:
    # Tool authority is runtime configuration, never a model's self-reported claim.
    if language == "en":
        return (
            "I'm İzge, your company colleague. I can help you:\n\n"
            "- Read accessible company files, chat attachments, daily logs and open work.\n"
            "- Compare contracts, requests, completed work and invoices with sources.\n"
            "- Identify forgotten requests, customer risks, missing bid requirements, recurring incidents and pending approvals.\n"
            "- Prepare summaries, response drafts and next steps; review drafts with a separate model call.\n"
            "- Produce daily evaluations through configured automations.\n\n"
            + ("**Web:** public search is enabled for this request.\n" if web_enabled else "**Web:** search is disabled for this request or not configured.\n")
            + ("**Company MCP:** " + ", ".join(f"{tool['connector_id']}/{tool['name']}" for tool in mcp_tools) + " (read-only).\n" if mcp_tools else "**Company MCP:** no authorized connector is enabled for this request.\n")
            + "\n**Limits:** I cannot issue invoices, send email, read a mailbox, close tickets, modify source files or write to external systems. "
            "I can propose these steps, not execute them. Company evidence is searched when needed; this capability overview did not search your files."
        )
    return (
        "Ben İzge, şirket içi çalışma arkadaşınızım. Şunlarda yardımcı olabilirim:\n\n"
        "- Erişim izni bulunan şirket dosyalarını, sohbet eklerini, günlükleri ve açık işleri okumak.\n"
        "- Sözleşmeleri, talepleri, yapılan işleri ve faturaları kaynaklarıyla karşılaştırmak.\n"
        "- Unutulan talepleri, müşteri risklerini, ihale eksiklerini, tekrarlayan sorunları ve bekleyen onayları belirlemek.\n"
        "- Özet, yanıt taslağı ve sonraki adım önerileri hazırlamak; ayrı model çağrısıyla taslağı denetlemek.\n"
        "- Yapılandırılmış otomasyonlarla günlük değerlendirmeler üretmek.\n\n"
        + ("**Web:** bu istek için herkese açık arama etkin.\n" if web_enabled else "**Web:** bu istek için arama kapalı veya yapılandırılmadı.\n")
        + ("**Şirket MCP:** " + ", ".join(f"{tool['connector_id']}/{tool['name']}" for tool in mcp_tools) + " (salt okuma).\n" if mcp_tools else "**Şirket MCP:** bu istek için yetkili bağlantı etkin değil.\n")
        + "\n**Sınırlarım:** Fatura kesemem, e-posta gönderemem, mailbox okuyamam, ticket kapatamam, kaynak dosyalarını değiştiremem ve dış sistemlere yazamam. "
        "Bu işlemleri gerçekleştirmek yerine size gerekli adımları önerebilirim. Şirket kanıtlarını gerektiğinde ararım; bu yetenek özeti için dosyalarınızı taramadım."
    )
